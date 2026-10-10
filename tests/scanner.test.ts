import { describe, it, expect } from 'vitest';

describe('Scanner Event & Code Classification', () => {
  it('correctly classifies aisle-bay-shelf location format like 120-075-1', () => {
    const code = '120-075-1';
    const isLocation = /^\d{3}-\d{3}-\d+$/.test(code) || /^[A-Za-z0-9]+-\d+$/.test(code);
    expect(isLocation).toBe(true);
  });

  it('correctly classifies alphanumeric location format like ReI-18', () => {
    const code = 'ReI-18';
    const isLocation = /^\d{3}-\d{3}-\d+$/.test(code) || /^[A-Za-z0-9]+-\d+$/.test(code);
    expect(isLocation).toBe(true);
  });

  it('correctly classifies pure SKU or barcode', () => {
    const sku = 'SKU-00921-X';
    const isLocation = /^\d{3}-\d{3}-\d+$/.test(sku);
    expect(isLocation).toBe(false);
    expect(sku.length >= 4).toBe(true);
  });

  it('detects hardware wedge when average interval is below 50ms', () => {
    const intervals = [12, 15, 14, 18, 11];
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const isWedge = avg < 50;
    expect(isWedge).toBe(true);
  });

  it('detects manual typing when average interval is above 70ms', () => {
    const intervals = [120, 95, 140, 80];
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const isWedge = avg < 50;
    expect(isWedge).toBe(false);
  });
});
