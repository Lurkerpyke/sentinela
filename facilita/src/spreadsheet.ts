import * as XLSX from 'xlsx'
import type { Conference } from './database'
import type { InventoryItem } from './domain'

export const spreadsheetHeaders = [
    'Código de barras',
    'Descrição',
    'Quantidade',
    'Data de vencimento',
] as const

const millisecondsPerDay = 24 * 60 * 60 * 1000
const excelEpoch = Date.UTC(1899, 11, 30)
const spreadsheetMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function excelDateSerial(isoDate: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
    if (!match) throw new RangeError('Data de vencimento inválida para a planilha.')

    const [, yearText, monthText, dayText] = match
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const dateTimestamp = Date.UTC(year, month - 1, day)
    const date = new Date(dateTimestamp)

    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new RangeError('Data de vencimento inválida para a planilha.')
    }

    return (dateTimestamp - excelEpoch) / millisecondsPerDay
}

export function createConferenceSpreadsheet(conference: Conference, items: InventoryItem[]) {
    const rows: (string | number)[][] = [
        [...spreadsheetHeaders],
        ...items.map((item) => [
            item.barcode,
            item.name,
            item.quantity,
            excelDateSerial(item.dueDate),
        ]),
    ]
    const worksheet = XLSX.utils.aoa_to_sheet(rows)

    for (let rowNumber = 2; rowNumber <= items.length + 1; rowNumber += 1) {
        const dateCell = worksheet[XLSX.utils.encode_cell({ r: rowNumber - 1, c: 3 })]
        if (dateCell) dateCell.z = 'dd/mm/yyyy'
    }

    worksheet['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 14 }, { wch: 22 }]
    worksheet['!autofilter'] = { ref: `A1:D${Math.max(items.length + 1, 1)}` }

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Validade')

    const startedAt = new Date(conference.startedAt)
    const datePart = [
        startedAt.getFullYear(),
        String(startedAt.getMonth() + 1).padStart(2, '0'),
        String(startedAt.getDate()).padStart(2, '0'),
    ].join('-')
    const timePart = `${String(startedAt.getHours()).padStart(2, '0')}${String(startedAt.getMinutes()).padStart(2, '0')}`
    const sectorPart = conference.sector
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

    return {
        workbook,
        filename: `validade_${sectorPart}_${datePart}_${timePart}.xlsx`,
    }
}

export function workbookToBlob(workbook: XLSX.WorkBook): Blob {
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    return new Blob([data], { type: spreadsheetMimeType })
}

export function createSpreadsheetFile(conference: Conference, items: InventoryItem[]): { file: File; filename: string } {
    const { workbook, filename } = createConferenceSpreadsheet(conference, items)
    const file = new File([workbookToBlob(workbook)], filename, { type: spreadsheetMimeType })
    return { file, filename }
}
