import { CompletionOptions, TabAutocompleteOptions } from "../..";
import { getBasename, getLastNPathParts } from "../../util";
import { decideMultilineEarly } from "../classification/shouldCompleteMultiline";
import { AutocompleteLanguageInfo } from "../constants/AutocompleteLanguageInfo";
import { AutocompleteSnippet } from "../context/ranking";
import { AutocompleteInput } from "../types";
import { getTemplateForModel } from "./AutocompleteTemplate";

export function formatExternalSnippet(
  filepath: string,
  snippet: string,
  language: AutocompleteLanguageInfo,
) {
  const comment = language.singleLineComment;
  const lines = [
    `${comment} Path: ${getBasename(filepath)}`,
    ...snippet
      .trim()
      .split("\n")
      .map((line) => `${comment} ${line}`),
    comment,
  ];
  return lines.join("\n");
}

export function renderPrompt(
  options: TabAutocompleteOptions,
  prefix: string,
  suffix: string,
  filepath: string,
  lang: AutocompleteLanguageInfo,
  snippets: AutocompleteSnippet[],
  model: string,
  workspaceDirs: string[],
  userDefinedTemplate: string | undefined,
  selectedCompletionInfo: AutocompleteInput["selectedCompletionInfo"],
  completeMultiline: boolean,
): [string, Partial<CompletionOptions> | undefined, boolean] {
  // Template prompt
  let {
    template,
    completionOptions,
    compilePrefixSuffix = undefined,
  } = userDefinedTemplate
    ? { template: userDefinedTemplate, completionOptions: {} }
    : getTemplateForModel(model);

  let prompt: string;
  const filename = getBasename(filepath);
  const reponame = getBasename(workspaceDirs[0] ?? "myproject");

  // Some models have prompts that need two passes. This lets us pass the compiled prefix/suffix
  // into either the 2nd template to generate a raw string, or to pass prefix, suffix to a FIM endpoint
  if (compilePrefixSuffix) {
    [prefix, suffix] = compilePrefixSuffix(
      prefix,
      suffix,
      filepath,
      reponame,
      snippets,
    );
  }

  if (typeof template === "string") {
    const compiledTemplate = Handlebars.compile(template);

    // Format snippets as comments and prepend to prefix
    const formattedSnippets = snippets
      .map((snippet) =>
        formatExternalSnippet(snippet.filepath, snippet.contents, lang),
      )
      .join("\n");
    if (formattedSnippets.length > 0) {
      prefix = `${formattedSnippets}\n\n${prefix}`;
    } else if (prefix.trim().length === 0 && suffix.trim().length === 0) {
      // If it's an empty file, include the file name as a comment
      prefix = `${lang.singleLineComment} ${getLastNPathParts(
        filepath,
        2,
      )}\n${prefix}`;
    }

    prompt = compiledTemplate({
      prefix,
      suffix,
      filename,
      reponame,
      language: lang.name,
    });
  } else {
    // Let the template function format snippets
    prompt = template(prefix, suffix, filepath, reponame, lang.name, snippets);
  }

  // Stop tokens
  const stopTokens = [
    ...(completionOptions?.stop || []),
    // ...multilineStops,
    ...commonStops,
    ...(model.toLowerCase().includes("starcoder2")
      ? STARCODER2_T_ARTIFACTS
      : []),
    ...(lang.stopWords ?? []),
    // ...lang.topLevelKeywords.map((word) => `\n${word}`),
  ];

  const multiline =
    !options.transform ||
    decideMultilineEarly({
      multilineCompletions: options.multilineCompletions,
      language: lang,
      selectedCompletionInfo: selectedCompletionInfo,
      prefix,
      suffix,
      completeMultiline,
    });

  completionOptions = {
    ...completionOptions,
    stop: stopTokens,
  };

  return [prompt, completionOptions, multiline];
}
