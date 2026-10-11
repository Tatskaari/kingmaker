---
summary: "Verify accepted gifts and trades and commit their typed inventory consequences once."
visibility: gm
---
Review only an agreed gift, payment, handover or trade in this turn. Verify accepted terms and actual possessions before applying an exchange. Read each owner's inventory using read_inventory and use its returned SHA with update_inventories; update both owners in one call for a transfer and preserve unrelated items and equipment.

An unrecorded harmless prop may be created as a narrative item with a unique ID, name, details and quantity, without an invented mechanical definition. Do not duplicate an exchange already reflected in current inventories. Rejected offers, unaccepted requests and hypothetical trades make no transfer. Record any necessary private memory with save_memory; memory or presentation prose alone does not transfer possessions. Do not assign activities or change unrelated lore, quests or relationships.
