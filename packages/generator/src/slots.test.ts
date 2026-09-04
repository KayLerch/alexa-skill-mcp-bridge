import { describe, expect, it } from 'vitest';
import { classify, planSlots } from './slots.js';

describe('classify', () => {
  it('maps schema types and names to slot kinds', () => {
    expect(classify('checkIn', { type: 'string' })).toBe('AMAZON.DATE');
    expect(classify('when', { type: 'string' })).toBe('AMAZON.DATE');
    expect(classify('x', { type: 'string', format: 'date' })).toBe('AMAZON.DATE');
    expect(classify('guests', { type: 'integer' })).toBe('AMAZON.NUMBER');
    expect(classify('price', { type: 'number' })).toBe('AMAZON.NUMBER');
    expect(classify('smoking', { type: 'boolean' })).toBe('yesNo');
    expect(classify('room', { type: 'string', enum: ['single', 'double'] })).toBe('enum');
    expect(classify('room', { type: 'string', oneOf: [{ const: 's', title: 'Single' }] })).toBe(
      'enum',
    );
    expect(classify('destination', { type: 'string' })).toBe('searchQuery');
    expect(classify('city', { type: ['string', 'null'] })).toBe('searchQuery');
  });
});

describe('planSlots', () => {
  const hotelSchema = {
    type: 'object',
    properties: {
      destination: { type: 'string' },
      checkIn: { type: 'string' },
      checkOut: { type: 'string' },
      guests: { type: 'integer', minimum: 1, maximum: 6 },
    },
    required: ['destination', 'checkIn', 'checkOut'],
  };

  it('builds the sample server hotel slots', () => {
    const plan = planSlots('search_hotels', hotelSchema);
    expect(plan.slots.map((s) => [s.slot, s.slotType, s.required])).toEqual([
      ['checkIn', 'AMAZON.DATE', true],
      ['checkOut', 'AMAZON.DATE', true],
      ['guests', 'AMAZON.NUMBER', false],
      ['destination', 'AMAZON.SearchQuery', true],
    ]);
    expect(plan.elicitedArguments).toEqual([]);
    expect(plan.customTypes).toEqual([]);
  });

  it('allows one SearchQuery slot per intent and leaves the rest to the agent', () => {
    const plan = planSlots('send_note', {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        recipient: { type: 'string' },
      },
      required: ['body', 'recipient'],
    });
    expect(plan.slots.map((s) => s.slot)).toEqual(['body']);
    expect(plan.elicitedArguments).toEqual(['title', 'recipient']);
  });

  it('creates custom types for enums and booleans, with spoken values and ids', () => {
    const plan = planSlots('book_room', {
      type: 'object',
      properties: {
        roomType: {
          type: 'string',
          oneOf: [
            { const: 'std', title: 'Standard Room' },
            { const: 'ste', title: 'Suite' },
          ],
        },
        breakfast: { type: 'boolean' },
      },
    });
    const room = plan.slots.find((s) => s.argument === 'roomType');
    expect(room?.slotType).toBe('BookRoomRoomTypeType');
    expect(room?.customType?.values).toEqual([
      { value: 'standard room', id: 'std', synonyms: ['Standard Room'] },
      { value: 'suite', id: 'ste', synonyms: ['Suite'] },
    ]);
    expect(plan.slots.find((s) => s.argument === 'breakfast')?.slotType).toBe('YesNoType');
    expect(plan.customTypes.map((t) => t.name)).toEqual(['BookRoomRoomTypeType', 'YesNoType']);
  });
});
