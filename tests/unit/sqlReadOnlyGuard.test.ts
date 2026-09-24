// Read-only guard contract for the SQL console: the pure string gate in
// src/routes/sql.ts decides what the admin endpoint will even attempt.
// These tests pin the acceptance table — single SELECT/WITH statements
// (including CTEs, subqueries and parenthesized forms) pass; anything
// multi-statement, write/DDL-flavored, or garbage-led fails.
import { describe, it, expect } from 'vitest';
import { isReadOnlyQuery, readOnlyQueryRejection } from '@/routes/sql';

describe('isReadOnlyQuery — accepted queries', () => {
  it.each([
    ['plain select', 'SELECT 1'],
    ['lowercase select', 'select * from blocks'],
    ['mixed case', 'SeLeCt * FrOm blocks'],
    ['with CTE', 'WITH recent AS (SELECT * FROM transactions LIMIT 10) SELECT * FROM recent'],
    [
      'nested CTE',
      'WITH a AS (WITH b AS (SELECT 1 AS x) SELECT * FROM b) SELECT * FROM a',
    ],
    ['parenthesized select', '(SELECT 1)'],
    ['double parenthesized select', '((SELECT 1))'],
    ['subquery in FROM', 'SELECT * FROM (SELECT block_number FROM blocks) sub'],
    ['one optional trailing semicolon', 'SELECT 1;'],
    ['trailing semicolon after whitespace trim', '  SELECT 1 ;  '],
    ['leading whitespace and newlines', '\n  SELECT\n   1'],
    [
      'union of parenthesized selects',
      '(SELECT 1 AS x) UNION ALL (SELECT 2 AS x)',
    ],
    ['table functions are reads too', 'SELECT * FROM read_parquet(\'x.parquet\')'],
  ])('accepts %s', (_name, query) => {
    expect(isReadOnlyQuery(query)).toBe(true);
    expect(readOnlyQueryRejection(query)).toBeNull();
  });
});

describe('isReadOnlyQuery — rejected queries', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n\t '],
    ['lone semicolon', ';'],
    ['two statements', 'SELECT 1; SELECT 2'],
    ['statement after trailing semicolon', 'SELECT 1;;'],
    ['leading garbage', 'EXPLAIN SELECT 1'],
    ['describe', 'DESCRIBE blocks'],
    ['show', 'SHOW TABLES'],
    ['values-led', 'VALUES (1)'],
    ['from-led', 'FROM blocks SELECT *'],
  ])('rejects %s', (_name, query) => {
    expect(isReadOnlyQuery(query)).toBe(false);
    expect(readOnlyQueryRejection(query)).not.toBeNull();
  });

  // Every forbidden word, in every casing, anywhere in the text — even in
  // a position a parser would treat as inert (comment, string literal):
  // the guard is deliberately conservative because it is a string gate.
  it.each([
    'INSERT',
    'UPDATE',
    'DELETE',
    'INTO',
    'CREATE',
    'DROP',
    'ALTER',
    'TRUNCATE',
    'COPY',
    'ATTACH',
    'DETACH',
    'PRAGMA',
    'INSTALL',
    'LOAD',
    'EXPORT',
    'IMPORT',
    'CALL',
    'EXECUTE',
    'PREPARE',
    'SET',
    'RESET',
    'USE',
  ])('rejects the word %s anywhere, case-insensitively', word => {
    expect(isReadOnlyQuery(`SELECT * FROM t WHERE note = '${word}'`)).toBe(false);
    expect(isReadOnlyQuery(`select 1 -- ${word.toLowerCase()}`)).toBe(false);
    expect(isReadOnlyQuery(`SELECT * FROM t /* ${word} */`)).toBe(false);
  });

  it('rejects DML/DDL statements outright', () => {
    expect(isReadOnlyQuery('INSERT INTO blocks VALUES (1)')).toBe(false);
    expect(isReadOnlyQuery('DROP TABLE blocks')).toBe(false);
    expect(isReadOnlyQuery('WITH x AS (SELECT 1) DELETE FROM blocks')).toBe(false);
    expect(isReadOnlyQuery('COPY blocks TO \'out.csv\'')).toBe(false);
    expect(isReadOnlyQuery('ATTACH \'other.db\' AS other')).toBe(false);
    expect(isReadOnlyQuery('PRAGMA database_list')).toBe(false);
  });

  it('does not reject words merely contained in identifiers', () => {
    // 'settings' contains "set", 'updates' contains "update" — word-token
    // matching must not fire on substrings.
    expect(isReadOnlyQuery('SELECT * FROM settings')).toBe(true);
    expect(isReadOnlyQuery('SELECT * FROM updates')).toBe(true);
    expect(isReadOnlyQuery('SELECT * FROM user_settings')).toBe(true);
    // ...but an identifier spelled exactly like a forbidden word still
    // rejects — the guard cannot tell identifiers from keywords, and a
    // false reject is the safe direction for a raw-SQL surface.
    expect(isReadOnlyQuery('SELECT * FROM "load"')).toBe(false);
  });

  it('names the violated rule in the rejection message', () => {
    expect(readOnlyQueryRejection('SELECT 1; SELECT 2')).toMatch(/single statement/i);
    expect(readOnlyQueryRejection('EXPLAIN SELECT 1')).toMatch(/SELECT or WITH/i);
    expect(readOnlyQueryRejection('DELETE FROM t')).toMatch(/SELECT or WITH/i);
    expect(readOnlyQueryRejection('SELECT * FROM t WHERE x = 1 AND y = 2 -- SET')).toMatch(
      /"SET"/,
    );
    expect(readOnlyQueryRejection('')).toMatch(/empty/i);
  });
});
