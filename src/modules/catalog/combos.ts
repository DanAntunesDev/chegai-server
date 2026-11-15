export interface Combo {
  id: string;
  items: string[];
}

export function groupCombos(rows: { comboId: string; serviceId: string }[]): Combo[] {
  const byCombo = new Map<string, string[]>();
  for (const row of rows) {
    byCombo.set(row.comboId, [...(byCombo.get(row.comboId) ?? []), row.serviceId]);
  }
  return [...byCombo.entries()].map(([id, items]) => ({ id, items }));
}

export function applyCombos(selected: string[], combos: Combo[]): string[] {
  let result = [...new Set(selected)];
  for (const combo of combos) {
    if (result.includes(combo.id)) {
      result = result.filter((id) => !combo.items.includes(id));
    }
  }
  const ordered = [...combos].sort((a, b) => b.items.length - a.items.length);
  for (const combo of ordered) {
    if (combo.items.length > 1 && combo.items.every((id) => result.includes(id))) {
      const position = result.findIndex((id) => combo.items.includes(id));
      result = result.filter((id) => !combo.items.includes(id));
      result.splice(Math.max(0, position), 0, combo.id);
    }
  }
  return result;
}
