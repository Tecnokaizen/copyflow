import Papa from "papaparse";

import { ImportFileError } from "./errors";

export const CSV_DELIMITERS = [";", ",", "\t"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Parses CSV text into rows of strings. Every cell stays text (no dynamic
 * typing), so phones, tax ids and leading zeros are never altered.
 */
export function parseCsvText(text: string): { rows: string[][]; delimiter: CsvDelimiter } {
  const result = Papa.parse<string[]>(text, {
    delimiter: "",
    delimitersToGuess: [...CSV_DELIMITERS],
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  // An unterminated quote swallows the rest of the file into one cell: refuse
  // the file instead of silently importing part of it.
  const unterminated = result.errors.find((error) => error.code === "MissingQuotes");
  if (unterminated) {
    throw new ImportFileError("csv_unterminated_quote", typeof unterminated.row === "number" ? unterminated.row + 1 : undefined);
  }
  const delimiter = (CSV_DELIMITERS as readonly string[]).includes(result.meta.delimiter)
    ? (result.meta.delimiter as CsvDelimiter)
    : ";";
  return {
    rows: result.data.map((row) => row.map((cell) => (typeof cell === "string" ? cell : ""))),
    delimiter,
  };
}
