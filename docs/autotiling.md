# Palace autotiling

The palace is authored as floor regions. `dungeon-autotile.ts` compiles their
union into Kenney Tiny Dungeon sprite indexes; the canvas only renders the
resulting protobuf tile layers. Room regions and floor geometry share one source.

The wall and corner tables are adapted from the **Walls** and **Wall Details**
layers of Peter Kiš's [TiSu Tiny Dungeon example](https://github.com/peter-kish/tisu/blob/master/examples/kenney_tiny_dungeon/filters.tmx).
Its MIT notice is retained in `apps/web/public/assets/tisu.LICENSE.txt`.
This follows [Tiled's automapping](https://doc.mapeditor.org/en/stable/manual/automapping/)
pattern/replacement model, tailored to the actual tileset rather than assuming
it supplies a complete generic blob tileset.

Wall patterns read the original floor mask. Two corner passes read the evolving
sprite output, with a snapshot per rule to make matches independent of scan
direction. Unchanged pattern cells preserve earlier substitutions. North wall
shadows are added last. Rotated side shadows, random props and banners from
the upstream example are not included.

The layout leaves three solid rows between vertically stacked room floors:
bottom edge (26), top cap (2), brick face (40). Side-by-side floors have at least
two solid columns for their facing edges. Passage floors cut through those bands.
This spacing is an authoring constraint of the current example, not a claim that
the rules support arbitrary one-cell walls or all possible dungeon shapes.

Walkability comes from the authored floor mask, independently of sprite choice.
A solid bounded layer blocks movement even under a non-solid decoration. Brown
background layers under walkable floors are therefore non-solid. No runtime
movement or object interactions are implemented in this prototype.

The map test checks every room and connector floor is reachable from the Great
Hall, keeps the southern exterior entrance open, and checks representative
three-row wall bands so layout edits cannot silently collapse them.
