#!/usr/bin/env node
/**
 * SEO Auditor — scans all .astro pages and reports issues.
 * No API key required. Run: npm run seo:audit
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES_DIR = join(ROOT, 'src/pages');
const LAYOUT_FILE = join(ROOT, 'src/layouts/Layout.astro');

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function collectPages(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectPages(full, acc);
    else if (entry.endsWith('.astro') && entry !== 'about.astro') acc.push(full);
  }
  return acc;
}

function auditLayout() {
  const issues = [];
  const src = readFileSync(LAYOUT_FILE, 'utf8');
  if (!src.includes('<link rel="canonical"') && !src.includes("rel='canonical'")) {
    issues.push({ severity: 'error', msg: 'Layout.astro: missing <link rel="canonical"> tag' });
  }
  return issues;
}

function auditPage(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const rel = relative(ROOT, filePath);
  const issues = [];

  // 1. Meta description
  if (!src.includes('description=') && !src.includes('description =')) {
    issues.push({ severity: 'error', msg: 'Missing description= prop on <Layout>' });
  }

  // 2. Title
  if (!src.includes('title=') && !src.includes('title =')) {
    issues.push({ severity: 'error', msg: 'Missing title= prop on <Layout>' });
  }

  // 3. Schema markup
  if (!src.includes('application/ld+json')) {
    issues.push({ severity: 'warning', msg: 'No JSON-LD schema markup found' });
  }

  // 4. FTC disclosure before first affiliate link
  const firstAffiliateLinkIdx = Math.min(
    ...[
      src.indexOf('rel="noopener noreferrer sponsored"'),
      src.indexOf("rel='noopener noreferrer sponsored'"),
      src.indexOf('rel="sponsored'),
      src.indexOf("<ProductCard"),
    ].filter(i => i !== -1)
  );
  const disclosureKeywords = ['affiliate', 'commission', 'sponsored', 'compensat'];
  const hasInlineDisclosure = disclosureKeywords.some(kw => {
    const idx = src.toLowerCase().indexOf(kw);
    return idx !== -1 && idx < firstAffiliateLinkIdx;
  });
  if (firstAffiliateLinkIdx !== Infinity && !hasInlineDisclosure) {
    issues.push({
      severity: 'error',
      msg: 'FTC non-compliant: affiliate disclosure must appear before the first affiliate link, not only in the footer',
    });
  }

  // 5. rel="sponsored" on direct affiliate hrefs (ProductCard handles its own links correctly)
  const directAffiliatePattern = /href=["'][^"']*(?:samash\.com|sweetwater\.com|amazon\.com|amzn\.to)[^"']*["']/;
  const hasDirectAffiliateLinks = directAffiliatePattern.test(src);
  if (hasDirectAffiliateLinks && !src.includes('sponsored')) {
    issues.push({ severity: 'error', msg: 'Direct affiliate links found without rel="sponsored"' });
  }

  // 6. Internal links (count <a href="/) or <a href=`/`)
  const internalLinkMatches = src.match(/href=["']\//g) || [];
  if (internalLinkMatches.length < 2) {
    issues.push({
      severity: 'warning',
      msg: `Low internal link count: ${internalLinkMatches.length} found (aim for 3+)`,
    });
  }

  return { file: rel, issues };
}

function main() {
  console.log(`\n${BOLD}${CYAN}SEO Audit — HomeRecordingGear${RESET}\n`);

  const results = [];
  let errorCount = 0;
  let warningCount = 0;

  // Audit layout first
  const layoutIssues = auditLayout();
  if (layoutIssues.length > 0) {
    results.push({ file: 'src/layouts/Layout.astro', issues: layoutIssues });
    errorCount += layoutIssues.filter(i => i.severity === 'error').length;
  }

  // Audit each page
  const pages = collectPages(PAGES_DIR);
  for (const page of pages) {
    const result = auditPage(page);
    if (result.issues.length > 0) {
      results.push(result);
      errorCount += result.issues.filter(i => i.severity === 'error').length;
      warningCount += result.issues.filter(i => i.severity === 'warning').length;
    }
  }

  if (results.length === 0) {
    console.log(`${GREEN}All ${pages.length} pages passed.${RESET}\n`);
    return;
  }

  for (const { file, issues } of results) {
    console.log(`${BOLD}${file}${RESET}`);
    for (const { severity, msg } of issues) {
      const color = severity === 'error' ? RED : YELLOW;
      const label = severity === 'error' ? '✗ ERROR  ' : '⚠ WARNING';
      console.log(`  ${color}${label}${RESET} ${msg}`);
    }
    console.log();
  }

  const pageCount = pages.length;
  const cleanCount = pageCount - results.filter(r => !r.file.includes('Layout')).length;
  console.log(
    `${BOLD}Summary:${RESET} ${pageCount} pages scanned — ` +
    `${GREEN}${cleanCount} clean${RESET}, ` +
    `${RED}${errorCount} error(s)${RESET}, ` +
    `${YELLOW}${warningCount} warning(s)${RESET}\n`
  );
}

main();
