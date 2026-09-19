import Papa from 'papaparse';
import type { Loop } from '../types';

type ParsedRow = Pick<
  Loop,
  'tagName' | 'description' | 'signalType' | 'plcAddress' | 'area'
>;

// Header aliases so this tolerates real-world exports from AVEVA System
// Platform, Studio 5000, TIA Portal, etc. without the user reformatting.
const HEADER_ALIASES: Record<string, keyof ParsedRow> = {
  'tag name': 'tagName',
  tagname: 'tagName',
  tag: 'tagName',
  description: 'description',
  desc: 'description',
  'signal type': 'signalType',
  signaltype: 'signalType',
  type: 'signalType',
  'plc address': 'plcAddress',
  plcaddress: 'plcAddress',
  address: 'plcAddress',
  area: 'area',
  unit: 'area',
};

export interface CsvParseResult {
  rows: ParsedRow[];
  errors: string[];
  skippedRowCount: number;
}

export function parseTagCsv(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const errors: string[] = results.errors.map(
          (e) => `Row ${e.row}: ${e.message}`
        );

        // Build a normalized-header lookup for this file's actual columns.
        const fieldMap = new Map<string, keyof ParsedRow>();
        (results.meta.fields ?? []).forEach((field) => {
          const key = field.trim().toLowerCase();
          const mapped = HEADER_ALIASES[key];
          if (mapped) fieldMap.set(field, mapped);
        });

        if (!Array.from(fieldMap.values()).includes('tagName')) {
          return reject(
            new Error(
              'CSV is missing a "Tag Name" column. Expected headers like: Tag Name, Description, Signal Type, PLC Address.'
            )
          );
        }

        const rows: ParsedRow[] = [];
        let skipped = 0;

        for (const raw of results.data) {
          const normalized: Partial<ParsedRow> = {};
          for (const [originalHeader, value] of Object.entries(raw)) {
            const mapped = fieldMap.get(originalHeader);
            if (mapped) normalized[mapped] = (value ?? '').trim();
          }
          if (!normalized.tagName) {
            skipped++;
            continue;
          }
          rows.push({
            tagName: normalized.tagName,
            description: normalized.description ?? '',
            signalType: normalized.signalType ?? 'OTHER',
            plcAddress: normalized.plcAddress ?? '',
            area: normalized.area,
          });
        }

        resolve({ rows, errors, skippedRowCount: skipped });
      },
      error: (err) => reject(err),
    });
  });
}
