/**
 * Bot API 9.4+ colored buttons.
 * style: "primary" = blue · "success" = green · "danger" = red
 * Older Telegram clients ignore style and show default gray.
 */

export const BTN = {
  blue: "primary",
  green: "success",
  red: "danger"
};

/** Attach color style to an inline button object. */
export function styled(button, style = BTN.blue) {
  if (!button || typeof button !== "object") return button;
  const s = String(style || "").toLowerCase();
  const mapped =
    s === "primary" || s === "blue"
      ? "primary"
      : s === "success" || s === "green"
        ? "success"
        : s === "danger" || s === "red"
          ? "danger"
          : null;
  if (!mapped) return { ...button };
  return { ...button, style: mapped };
}

export function blue(button) {
  return styled(button, BTN.blue);
}

export function green(button) {
  return styled(button, BTN.green);
}

export function red(button) {
  return styled(button, BTN.red);
}

/** Cycle blue → green → red for product rows. */
export function productStyle(index = 0) {
  const cycle = [BTN.blue, BTN.green, BTN.red];
  return cycle[Math.abs(Number(index) || 0) % cycle.length];
}

/** Map a whole keyboard, applying a style fn per button via (btn, rowIndex, colIndex). */
export function styleKeyboard(keyboard, styleForButton) {
  const rows = keyboard?.inline_keyboard || [];
  return {
    inline_keyboard: rows.map((row, ri) =>
      (row || []).map((btn, ci) => {
        const style = typeof styleForButton === "function" ? styleForButton(btn, ri, ci) : styleForButton;
        return styled(btn, style);
      })
    )
  };
}
