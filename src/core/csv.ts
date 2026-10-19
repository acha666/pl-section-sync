import Papa from 'papaparse';
import type { Gradebook, GradebookRecord } from './types.js';
import { MAX_CSV_BYTES, requireValue } from './model.js';

/** RFC 4180 records as text. No type coercion or formula evaluation. */
export function parseCsv(text: string): string[][] {
  requireValue(text.length <= MAX_CSV_BYTES, 'CSV is larger than the 20 MB limit.');
  // Mixed line endings are accepted; outside quotes each one ends a record.
  const { data, errors } = Papa.parse<string[]>(
    text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'),
    { delimiter: ',', newline: '\n', skipEmptyLines: 'greedy' },
  );
  requireValue(!errors.length, `Malformed CSV: ${errors[0]?.message}. Export the gradebook again.`);
  return data;
}
export function readGradebook(text: string): Gradebook {
  const rows = parseCsv(text);
  requireValue(rows.length > 1, 'The CSV has no student records.');
  const headers = rows.shift()!.map((h) => h.trim());
  requireValue(new Set(headers).size === headers.length, 'Duplicate CSV column names.');
  for (const h of ['ID', 'SIS Login ID', 'Section'])
    requireValue(headers.includes(h), `Missing CSV column: ${h}.`);
  const at = (r: string[], name: string) => (r[headers.indexOf(name)] ?? '').trim();
  const records: GradebookRecord[] = [],
    issues: string[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    // Canvas's points/read-only metadata rows do not identify a Canvas student.
    if (
      !at(row, 'ID') &&
      (!at(row, 'Student') || /^(points possible|\(read only\))$/i.test(at(row, 'Student')))
    ) {
      skipped++;
      return;
    }
    requireValue(
      row.length === headers.length,
      `CSV record ${index + 2} has an unexpected number of fields.`,
    );
    const id = at(row, 'ID');
    if (!/^\d+$/.test(id)) {
      issues.push(`Record ${index + 2}: missing or invalid Canvas ID.`);
      return;
    }
    records.push({
      id,
      sis: at(row, 'SIS Login ID'),
      section: at(row, 'Section'),
      name: at(row, 'Student') || `Canvas student ${id}`,
    });
  });
  requireValue(records.length > 0, 'The CSV has no valid Canvas student records.');
  return { records, issues, skipped };
}
/** Canvas flattens section arrays into prose. These are candidates, reviewed in the UI. */
export function suggestSections(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/,\s+and\s+|\s+and\s+|,\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
