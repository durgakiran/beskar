### Issue 1: Selection of a row breaks when cells are merged.

#### What is the issue
When several cells of a column are merged, then selection of row breaks.

#### How to reproduce
1. Create a table with 4 rows and 3 columns
2. merge cell of column 1 across rows 2 and 3 (a rowspan/vertical cell merge).
3. Try selecting the entire fourth row (or any row below merged region) by clicking on the row drag handler button 
4. The unmerged cells (columns 2 and 3) of row 3 are selected (or unmerged cells of previous row are selected)

#### Expected behaviour
Selecting a row by clicking on the row drag handler, should only select the current row cells.  For example, if row 4 has all individual cells, selecting it should highlight only those cells of 4th row.

#### Images
![Issue when selecting a row](./assets/table%20cell%20selection%20issue.png)


### Issue 2: Slash command doesn't work in table cells

#### What is the issue
When we want to write something to empty cell of a table node, the slash command doesn't work. This prevents accessing advanced editing options while editing tables.

#### How to reproduce
1. Create a table
2. Type `/` on empty cell
3. / character typed normall and nothing else occurs.

#### Expected behaviour
Slash command should work by opening the advanced node menu and all the commands should appear.

### Issue 3: Bubble menu doesn't open on selecting text in table cell

#### What is the issue
When we select a range of text on any table cell, the bubble menu options are not available.

#### How to reproduce
1. Create a table
2. Type some text in a cell
3. Select/highlight that text
4. Observe: bubble menu does not appear

#### Expected behaviour
Selecting a text in a table cell, should open the bubble menu, just like for any other normal paragraph node. The menu shouldn't open on cell selection (multi cell selection).

### Issue 4: When a table is created with a header row or header column toggled on, the th cells render with no visual distinction from regular td cells — no background colour is applied by default

#### What is the issue
When a table is created with a header row or header column toggled on, the th cells render with no visual distinction from regular td cells — no background colour is applied by default

#### How to reproduce
create a table, use the row handle menu to toggle header row on, observe that the header row looks identical to regular rows.

#### Expected behaviour
Table's heading row or column should get a background colour like light gray (rgb(243, 244, 246)). The behaviour is same for overlapping cells, in case of heading row and heading column overlaps.

