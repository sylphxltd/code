# File Storage Analysis

## Current Implementation

### How files are currently stored:

**1. When user submits message with files** (`streaming.service.ts:191-229`):
```typescript
// Read file ONCE and freeze as base64
const buffer = await fs.readFile(part.path);
const base64 = buffer.toString('base64');
const mimeType = part.mimeType || lookup(part.path) || 'application/octet-stream';

frozenContent.push({
  type: 'file',
  relativePath: part.relativePath,
  size: buffer.length,
  mediaType: mimeType,
  base64,  // ← ALL files stored as base64
  status: 'completed',
});
```

**2. Stored in database**:
- Table: `step_parts`
- Column: `content` (TEXT type, stores JSON)
- JSON structure:
```json
{
  "type": "file",
  "relativePath": "src/app.ts",
  "size": 1024,
  "mediaType": "text/plain",
  "base64": "Y29uc3QgYXBwID0g...",
  "status": "completed"
}
```

**3. Text vs Binary differentiation** (`message-builder.ts:88-103`):

**NO distinction at storage time** - all files stored identically as base64.

Differentiation happens **only at display/send time** using `mediaType`:

```typescript
if (part.mediaType.startsWith('text/') || part.mediaType === 'application/json') {
  // Text file - decode and show content
  const text = buffer.toString('utf-8');
  contentParts.push({
    type: 'text',
    text: `<file path="${part.relativePath}">\n${text}\n</file>`,
  });
} else {
  // Binary file - just mention it
  contentParts.push({
    type: 'text',
    text: `<file path="${part.relativePath}" type="${part.mediaType}" size="${part.size}">\n[Binary file content not shown]\n</file>`,
  });
}
```

## Issues with Current Approach

### 1. Storage Overhead
- **Base64 encoding**: 33% size increase (3 bytes → 4 chars)
- **JSON encoding**: Additional overhead for escaping and structure
- **Example**: 1MB text file → 1.33MB base64 → ~1.4MB in JSON

### 2. Not Searchable
- Text file content stored as base64 string
- Cannot use SQL LIKE or FTS5 for conversation search
- Would need to decode all files to search content

### 3. Scale Issues
- **User reported**: "大多數 assistant message 都超過 100 steps"
- 100 steps × multiple files per step × base64 overhead = huge JSON blobs
- Large JSON in TEXT column slows down:
  - Database queries (must load entire JSON)
  - Deserialization (parse huge JSON strings)
  - Memory usage (full content in memory)

### 4. Query Performance
- Each query loads full file content even when not needed
- Cannot efficiently filter or paginate by file properties
- No way to load "messages without file content" for list views

## Proposed Solutions

### Option A: Keep Current (Baseline)
```
Current: ALL files in step_parts.content JSON as base64
```

**Pros:**
- ✅ No schema changes needed
- ✅ Order preserved with text content
- ✅ Simple implementation

**Cons:**
- ❌ Not searchable (base64 encoded)
- ❌ Storage inefficient (33%+ overhead)
- ❌ Slow queries with 100+ steps
- ❌ Memory intensive

**Verdict:** Not viable for 100+ steps per message use case

---

### Option B: Separate file_contents Table (RECOMMENDED)

```sql
CREATE TABLE file_contents (
  id TEXT PRIMARY KEY,
  step_id TEXT REFERENCES message_steps(id) ON DELETE CASCADE,
  ordering INTEGER NOT NULL,  -- Position within step
  relative_path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  content BLOB NOT NULL,      -- Binary storage (no base64!)
  is_text INTEGER NOT NULL,   -- 1 for text files, 0 for binary
  text_content TEXT,          -- Decoded text for text files (FTS5 indexable)
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_file_contents_step ON file_contents(step_id, ordering);
CREATE INDEX idx_file_contents_type ON file_contents(media_type);

-- FTS5 index for text file search
CREATE VIRTUAL TABLE file_contents_fts USING fts5(
  relative_path,
  text_content,
  content=file_contents,
  content_rowid=rowid
);
```

**Schema changes:**
```typescript
// step_parts.content JSON - file reference instead of full content
{
  type: 'file-ref',
  fileContentId: 'fc_abc123',
  relativePath: 'src/app.ts',  // Denormalized for display
  size: 1024,
  mediaType: 'text/plain',
  status: 'completed'
}

// file_contents table - actual file storage
{
  id: 'fc_abc123',
  step_id: 'msg-123-step-0',
  ordering: 2,
  relative_path: 'src/app.ts',
  media_type: 'text/plain',
  size: 1024,
  content: <binary blob>,
  is_text: 1,
  text_content: 'const app = ...', // For text files only
  created_at: 1234567890
}
```

**Pros:**
- ✅ **Storage efficient**: No base64 overhead (33% smaller)
- ✅ **Searchable**: FTS5 index on text_content for full-text search
- ✅ **Query performance**: Can load messages without file content
- ✅ **Scalable**: Large files don't bloat step_parts table
- ✅ **Flexible**: Can add metadata (hash, compression, etc.)

**Cons:**
- ❌ **Complexity**: Requires JOIN to reconstruct full message
- ❌ **Order**: Text-to-file order requires manual reconstruction
- ❌ **Migration**: Need to convert existing data

**Implementation:**
1. Add `file_contents` table
2. Update `streaming.service.ts` to insert files into new table
3. Update `message-builder.ts` to JOIN and reconstruct content
4. Create migration to move existing files
5. Add FTS5 triggers for text file indexing

---

### Option C: Hybrid Approach

```typescript
// Text files: Store as decoded text in step_parts (inline, searchable)
{
  type: 'text',
  content: '<file path="src/app.ts">\nconst app = ...\n</file>',
  status: 'completed'
}

// Binary files: Store reference in step_parts, content in file_contents
{
  type: 'file-ref',
  fileContentId: 'fc_abc123',
  relativePath: 'image.png',
  size: 102400,
  mediaType: 'image/png',
  status: 'completed'
}
```

**Pros:**
- ✅ Text files searchable (stored as text in step_parts)
- ✅ Binary files efficient (BLOB in file_contents)
- ✅ Order preserved for text (inline with other text parts)
- ✅ Most common case (text files) simple and fast

**Cons:**
- ❌ Complex logic (two different storage paths)
- ❌ Binary files still lose order guarantee
- ❌ Text files still in JSON (some overhead)
- ❌ Harder to maintain consistency

**Verdict:** More complex than Option B with marginal benefits

---

### Option D: Wait for SQLite JSONB

SQLite 3.45+ has improved JSON support, but:
- Not widely available yet
- Still has overhead compared to BLOB
- Doesn't solve searchability issue

**Verdict:** Not ready for production

## Recommendation: Option B

**Reasons:**

1. **Scale**: With 100+ steps per message, storage efficiency is critical
   - Current: 100 steps × 5 files × 10KB × 1.33 (base64) = 6.65MB per message
   - New: 100 steps × 5 files × 10KB = 5MB per message (25% smaller)

2. **Future conversation search**:
   - FTS5 index on text_content enables full-text search
   - Can search across all conversations efficiently
   - Example: "Find all messages mentioning 'authentication'"

3. **Query performance**:
   - List view: Load messages without file content (fast)
   - Detail view: JOIN file_contents when needed (still fast)
   - Export: Can efficiently stream file content

4. **Order reconstruction is manageable**:
   - Add `ordering` field to preserve position
   - Most important: text-to-text order (preserved in step_parts)
   - Less critical: text-to-file order (can reconstruct from ordering)
   - UI can merge step_parts + file_contents sorted by ordering

## Implementation Plan

1. **Add file_contents table** (schema.ts)
2. **Update streaming service** to insert files into file_contents
3. **Update message builder** to JOIN file_contents when loading
4. **Create computed view** for message usage (replace messageUsage table)
5. **Remove stepTodoSnapshots** table and code
6. **Create migration** to move existing files
7. **Add FTS5 index** for text file search
8. **Test** with large sessions (100+ steps)

## Migration Strategy

```sql
-- Step 1: Create new table
CREATE TABLE file_contents (...);

-- Step 2: Migrate existing files
INSERT INTO file_contents (id, step_id, ordering, ...)
SELECT
  'fc_' || hex(randomblob(16)),
  sp.step_id,
  sp.ordering,
  json_extract(sp.content, '$.relativePath'),
  json_extract(sp.content, '$.mediaType'),
  json_extract(sp.content, '$.size'),
  base64_decode(json_extract(sp.content, '$.base64')),
  CASE
    WHEN json_extract(sp.content, '$.mediaType') LIKE 'text/%' THEN 1
    ELSE 0
  END,
  CASE
    WHEN json_extract(sp.content, '$.mediaType') LIKE 'text/%'
    THEN base64_decode_text(json_extract(sp.content, '$.base64'))
    ELSE NULL
  END,
  strftime('%s', 'now') * 1000
FROM step_parts sp
WHERE sp.type = 'file';

-- Step 3: Update step_parts to use file-ref
UPDATE step_parts
SET content = json_object(
  'type', 'file-ref',
  'fileContentId', (SELECT id FROM file_contents WHERE step_id = step_parts.step_id AND ordering = step_parts.ordering),
  'relativePath', json_extract(content, '$.relativePath'),
  'size', json_extract(content, '$.size'),
  'mediaType', json_extract(content, '$.mediaType'),
  'status', 'completed'
)
WHERE type = 'file';

-- Step 4: Create FTS5 index
CREATE VIRTUAL TABLE file_contents_fts USING fts5(...);
INSERT INTO file_contents_fts SELECT relative_path, text_content FROM file_contents WHERE is_text = 1;
```
