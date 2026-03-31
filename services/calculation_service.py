from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any


TWO_DECIMALS = Decimal("0.01")


def round_currency(value: float) -> float:
    return float(Decimal(str(value)).quantize(TWO_DECIMALS, rounding=ROUND_HALF_UP))


def calculate_area(width: float, height: float) -> float:
    return round_currency((width * height) / 144)


def calculate_item_total(area: float, quantity: int, rate: float) -> float:
    return round_currency(area * quantity * rate)


def calculate_tax_summary(subtotal: float) -> dict[str, float]:
    subtotal = round_currency(subtotal)
    cgst = round_currency(subtotal * 0.09)
    sgst = round_currency(subtotal * 0.09)
    grand_total = round_currency(subtotal + cgst + sgst)

    return {
        "subtotal": subtotal,
        "cgst": cgst,
        "sgst": sgst,
        "grand_total": grand_total,
    }


def build_boq_items(recce_items: list[dict[str, Any]], default_rate: float = 0) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, recce_item in enumerate(recce_items, start=1):
        area = calculate_area(recce_item["width"], recce_item["height"])
        item_total = calculate_item_total(area, recce_item["quantity"], default_rate)
        items.append(
            {
                "line_id": f"line-{index}",
                "title": recce_item["title"],
                "element_type": recce_item["element_type"],
                "width": recce_item["width"],
                "height": recce_item["height"],
                "depth": recce_item.get("depth", 0),
                "quantity": recce_item["quantity"],
                "rate": round_currency(default_rate),
                "area": area,
                "item_total": item_total,
                "remarks": recce_item.get("remarks"),
                "images": recce_item.get("images", []),
            }
        )
    return items


def recalculate_boq(items: list[dict[str, Any]]) -> dict[str, Any]:
    recalculated_items: list[dict[str, Any]] = []
    subtotal = 0.0

    for item in items:
        area = calculate_area(item["width"], item["height"])
        rate = round_currency(item["rate"])
        item_total = calculate_item_total(area, item["quantity"], rate)
        updated_item = {
            **item,
            "rate": rate,
            "area": area,
            "item_total": item_total,
        }
        recalculated_items.append(updated_item)
        subtotal += item_total

    return {
        "items": recalculated_items,
        **calculate_tax_summary(subtotal),
    }
