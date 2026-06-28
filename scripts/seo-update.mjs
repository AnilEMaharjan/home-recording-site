#!/usr/bin/env node
/**
 * SEO Auto-Updater — analyzes a specific page and outputs structured improvement recommendations.
 * Writes a .suggested.json file alongside the page for review before applying.
 * Requires: ANTHROPIC_API_KEY env var
 *
 * Usage:
 *   npm run seo:update -- src/pages/best-microphones-under-100.astro
 *   npm run seo:update -- --all   (runs against every page, takes a while)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES_DIR = join(ROOT, 'src/pages');

const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

function collectPages(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectPages(full, acc);
    else if (entry.endsWith('.astro')) acc.push(full);
  }
  return acc;
}

async function analyzePage(client, filePath) {
  const src = readFileSync(filePath, 'utf8');
  const relPath = relative(ROOT, filePath);
  const slug = '/' + relative(PAGES_DIR, filePath).replace(/\.astro$/, '').replace(/\/index$/, '');

  console.log(`\n${BOLD}${CYAN}Analyzing: ${relPath}${RESET}`);

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: `You are an SEO expert analyzing a page on HomeRecordingGear.com, a niche affiliate site for beginner home recording musicians.

Page URL: ${slug}
File: ${relPath}

Full page source:
\`\`\`astro
${src}
\`\`\`

Analyze this page and return a JSON object with SEO improvement recommendations. Follow this exact schema:

{
  "page": "${slug}",
  "analyzedAt": "ISO-8601 date",
  "currentMetaDescription": "existing description or null",
  "recommendations": {
    "metaDescription": {
      "current": "current value or null",
      "suggested": "improved 150-160 char description that includes target keyword naturally",
      "reason": "why this is better"
    },
    "titleTag": {
      "current": "current value or null",
      "suggested": "improved title with keyword near front, under 60 chars",
      "reason": "why this is better"
    },
    "ftcDisclosure": {
      "compliant": true or false,
      "issue": "description of issue or null if compliant",
      "fix": "exact HTML/text to add and where to add it, or null if compliant"
    },
    "schemaMarkup": {
      "present": true or false,
      "suggested": [
        {
          "type": "Schema.org type name",
          "json": { /* complete JSON-LD object */ },
          "placement": "where to add it in the page"
        }
      ]
    },
    "internalLinks": {
      "currentCount": number,
      "suggestions": [
        {
          "anchorText": "text to link",
          "targetPage": "/slug",
          "context": "where in the page to add this link and why"
        }
      ]
    },
    "contentGaps": [
      "specific missing section or topic that would improve rankings"
    ],
    "quickWins": [
      "1-line specific actionable improvement"
    ]
  },
  "priority": "high | medium | low",
  "priorityReason": "why this page is this priority level"
}

Return ONLY valid JSON. No markdown fences, no explanation outside the JSON.`,
      },
    ],
  });

  // Extract text from response (skip thinking blocks)
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  let recommendations;
  try {
    // Strip any accidental markdown fences
    const cleaned = textBlock.text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    recommendations = JSON.parse(cleaned);
    recommendations.analyzedAt = new Date().toISOString();
  } catch (err) {
    throw new Error(`Failed to parse Claude's JSON response: ${err.message}\nRaw: ${textBlock.text.slice(0, 300)}`);
  }

  const outPath = filePath.replace(/\.astro$/, '.suggested.json');
  writeFileSync(outPath, JSON.stringify(recommendations, null, 2));

  const usage = response.usage;
  const cost = ((usage.input_tokens * 5 + usage.output_tokens * 25) / 1_000_000).toFixed(4);

  console.log(`  ${GREEN}✓${RESET} Written to: ${relative(ROOT, outPath)}`);
  console.log(`  Priority: ${BOLD}${recommendations.priority?.toUpperCase()}${RESET} — ${recommendations.priorityReason}`);
  console.log(`  Quick wins:`);
  for (const win of (recommendations.recommendations?.quickWins || []).slice(0, 3)) {
    console.log(`    ${YELLOW}→${RESET} ${win}`);
  }
  console.log(`  Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out ($${cost})`);

  return recommendations;
}

async function main() {
  const args = process.argv.slice(2);
  const runAll = args.includes('--all');
  const client = new Anthropic();

  console.log(`\n${BOLD}${CYAN}SEO Auto-Updater — HomeRecordingGear${RESET}\n`);

  let targetPaths = [];

  if (runAll) {
    targetPaths = collectPages(PAGES_DIR);
    console.log(`Running against all ${targetPaths.length} pages. This will take a few minutes...\n`);
  } else if (args.length > 0) {
    const arg = args[0];
    const resolved = arg.startsWith('/') ? arg : join(ROOT, arg);
    targetPaths = [resolved];
  } else {
    console.error(`${RED}Usage:${RESET}`);
    console.error('  npm run seo:update -- src/pages/your-page.astro');
    console.error('  npm run seo:update -- --all');
    process.exit(1);
  }

  let totalCost = 0;
  const results = [];

  for (const filePath of targetPaths) {
    try {
      const result = await analyzePage(client, filePath);
      results.push({ file: relative(ROOT, filePath), result });
      const usage = 0; // already printed per-page
    } catch (err) {
      console.error(`  ${RED}✗${RESET} ${relative(ROOT, filePath)}: ${err.message}`);
    }
  }

  console.log(`\n${BOLD}Done.${RESET} ${results.length}/${targetPaths.length} pages analyzed.`);
  if (runAll) {
    const highPriority = results.filter(r => r.result?.priority === 'high');
    if (highPriority.length) {
      console.log(`\n${YELLOW}High priority pages:${RESET}`);
      for (const { file } of highPriority) {
        console.log(`  → ${file}`);
      }
    }
  }
  console.log(`\nReview the .suggested.json files alongside each page before applying changes.\n`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
