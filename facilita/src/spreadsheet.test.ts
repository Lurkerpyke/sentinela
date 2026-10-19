import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import type { Conference } from './database'
import type { InventoryItem } from './domain'
import { createConferenceSpreadsheet, excelDateSerial, spreadsheetHeaders, workbookToBlob } from './spreadsheet'

const conference: Conference = {
    id: 'conference-test',
    staffName: 'Leandro',
    sector: 'Mercearia',
    startedAt: '2026-10-01T14:35:00.000Z',
    status: 'pending',
}

const items: InventoryItem[] = [{
    id: 'item-test',
    conferenceId: conference.id,
    barcode: '0036000291452',
    name: 'Produto com zero inicial',
    quantity: 32,
    dueDate: '2026-10-26',
    unregistered: false,
    createdAt: '2026-10-01T14:35:00.000Z',
}]

describe('conference spreadsheet', () => {
    it('keeps the approved column order and exports code, number, and date with correct cell types', async () => {
        const { workbook, filename } = createConferenceSpreadsheet(conference, items)
        const blob = workbookToBlob(workbook)
        const bytes = await blob.arrayBuffer()
        const reopened = XLSX.read(bytes, { type: 'array', cellNF: true })
        const worksheet = reopened.Sheets.Validade

        expect(XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true })[0]).toEqual(spreadsheetHeaders)
        expect(worksheet.A2).toMatchObject({ t: 's', v: '0036000291452' })
        expect(worksheet.B2).toMatchObject({ t: 's', v: 'Produto com zero inicial' })
        expect(worksheet.C2).toMatchObject({ t: 'n', v: 32 })
        expect(worksheet.D2).toMatchObject({ t: 'n', v: excelDateSerial('2026-10-26'), z: 'dd/mm/yyyy' })
        expect(filename).toMatch(/^validade_mercearia_2026-10-01_\d{4}\.xlsx$/)
    })

    it('rejects an invalid due date instead of exporting it', () => {
        expect(() => excelDateSerial('2026-02-31')).toThrow(RangeError)
    })
})
