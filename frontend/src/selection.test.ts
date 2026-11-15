import { expect, test } from 'vitest';
import { validSelection } from './selection';

test('large and whole-world rectangles have no size cap', () => {
  expect(validSelection({ west: -180, east: 180, south: -90, north: 90 })).toBe(true);
  expect(validSelection({ west: -50, east: 30, south: -20, north: 40 })).toBe(true);
});
test('invalid and reversed coordinates still fail validation', () => {
  for (const area of [
    { west: 179, east: -179, south: 0, north: 10 },
    { west: -181, east: 0, south: 0, north: 10 },
    { west: 0, east: 10, south: 0, north: NaN },
    { west: 0, east: 10, south: 0, north: 91 },
  ]) expect(validSelection(area)).toBe(false);
});
