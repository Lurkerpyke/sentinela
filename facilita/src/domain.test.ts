import { describe, expect, it } from 'vitest'
import { isMoreThanYearsAhead, isPastDue, mergeDuplicateItems, normalizeBarcode, parseDueDate, type InventoryItem } from './domain'

describe('normalizeBarcode', () => {
    it('accepts EAN-13 while preserving it as text', () => {
        expect(normalizeBarcode('4006381333931')).toBe('4006381333931')
    })

    it('normalizes UPC-A to EAN-13 with a leading zero', () => {
        expect(normalizeBarcode('036000291452')).toBe('0036000291452')
    })

    it('accepts EAN-8', () => {
        expect(normalizeBarcode('96385074')).toBe('96385074')
    })

    it.each(['7891000458921', '7891037142213', '7896019600118', '7891000100103'])(
        'accepts demo catalog code %s',
        (barcode) => expect(normalizeBarcode(barcode)).toBe(barcode),
    )

    it('rejects unsupported lengths, non-digits, and an invalid check digit', () => {
        expect(normalizeBarcode('12345')).toBeNull()
        expect(normalizeBarcode('4006381333930')).toBeNull()
        expect(normalizeBarcode('40063813339A1')).toBeNull()
    })

    it('ignores surrounding spaces without converting the barcode to a number', () => {
        expect(normalizeBarcode(' 0036000291452 ')).toBe('0036000291452')
    })
})

describe('parseDueDate', () => {
    it('parses DDMMYY and expands the year into 20YY', () => {
        expect(parseDueDate('150326', 'day')).toBe('2026-03-15')
    })

    it('parses MMAAAA as the final day of that month', () => {
        expect(parseDueDate('032026', 'month')).toBe('2026-03-31')
        expect(parseDueDate('022024', 'month')).toBe('2024-02-29')
    })

    it('rejects impossible dates and months', () => {
        expect(parseDueDate('310226', 'day')).toBeNull()
        expect(parseDueDate('132026', 'month')).toBeNull()
        expect(parseDueDate('150326', 'month')).toBeNull()
    })
})

describe('date flags', () => {
    it('marks past dates as expired', () => {
        expect(isPastDue('2026-03-15', new Date(2026, 2, 16))).toBe(true)
        expect(isPastDue('2026-03-16', new Date(2026, 2, 16))).toBe(false)
    })

    it('flags dates more than five years in the future', () => {
        expect(isMoreThanYearsAhead('2031-10-02', 5, new Date(2026, 9, 1))).toBe(true)
        expect(isMoreThanYearsAhead('2031-10-01', 5, new Date(2026, 9, 1))).toBe(false)
    })
})

describe('mergeDuplicateItems', () => {
    const existing: InventoryItem = {
        id: 'item-1',
        conferenceId: 'conference-1',
        barcode: '4006381333931',
        name: 'Produto de exemplo',
        quantity: 2,
        dueDate: '2026-10-26',
        unregistered: false,
        createdAt: '2026-09-28T10:00:00.000Z',
    }

    it('sums quantities for the same barcode and due date', () => {
        const result = mergeDuplicateItems([existing], { ...existing, id: undefined, quantity: 3 })
        expect(result.merged).toBe(true)
        expect(result.savedItem.quantity).toBe(5)
        expect(result.savedItem.id).toBe(existing.id)
    })

    it('keeps different due dates as separate lines', () => {
        const result = mergeDuplicateItems([existing], { ...existing, id: undefined, dueDate: '2026-11-26', quantity: 1 })
        expect(result.merged).toBe(false)
        expect(result.savedItem.dueDate).toBe('2026-11-26')
    })

    it('keeps items in different conferences separate', () => {
        const result = mergeDuplicateItems([existing], { ...existing, id: undefined, conferenceId: 'conference-2', quantity: 1 })
        expect(result.merged).toBe(false)
        expect(result.savedItem.conferenceId).toBe('conference-2')
    })
})
