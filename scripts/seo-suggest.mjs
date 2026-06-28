#!/usr/bin/env node
/**
 * SEO Content Suggester — uses Claude to find keyword gaps and suggest new pages.
 * Requires: ANTHROPIC_API_KEY env var
 * Run: npm run seo:suggest
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES_DIR = join(ROOT, 'src/pages');

const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
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

function extractPageInfo(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const slug = relative(PAGES_DIR, filePath).replace(/\.astro$/, '');

  // Extract title from Layout prop
  const titleMatch = src.match(/title=["'`]([^"'`]+)["'`]/);
  const title = titleMatch ? titleMatch[1] : slug;

  // Extract description
  const descMatch = src.match(/description=["'`]([^"'`]+)["'`]/);
  const description = descMatch ? descMatch[1] : '';

  // Extract h1/h2 headings
  const headings = [...src.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/g)].map(m => m[1].trim());

  return { slug, title, description, headings: headings.slice(0, 3) };
}

async function main() {
  const client = new Anthropic();

  console.log(`\n${BOLD}${CYAN}SEO Content Suggester — HomeRecordingGear${RESET}\n`);
  console.log('Scanning existing pages...');

  const pages = collectPages(PAGES_DIR);
  const pageInfos = pages.map(extractPageInfo);

  const pageList = pageInfos.map(p => `- /${p.slug}: "${p.title}"`).join('\n');

  console.log(`Found ${pages.length} pages. Asking Claude for keyword gap analysis...\n`);

  const stream = await client.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: `You are an SEO strategist for a niche affiliate review site called HomeRecordingGear.com. The site targets beginner home recording musicians and podcasters who want honest gear recommendations on a budget.

Here are the existing pages:
${pageList}

Your job: identify keyword gaps and suggest 10 new pages this site should publish next. Focus on:
- Long-tail keywords with clear buying intent (e.g., "best X under $Y", "X vs Y", "do I need X")
- Beginner guides that funnel to product recommendations
- Comparison pages between popular products
- FAQ pages for common beginner questions

For each suggestion, provide:
1. Suggested URL slug (flat, no nesting, SEO-friendly)
2. Target keyword / page title
3. Search intent (informational / commercial / transactional)
4. Why this fills a gap (1–2 sentences)
5. Which existing pages to internally link to/from
6. Estimated difficulty (easy/medium/hard) and why

Format as a numbered list. Be specific to home recording — don't suggest generic music gear topics.`,
      },
    ],
  });

  process.stdout.write(`${BOLD}Claude's keyword gap analysis:${RESET}\n\n`);

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      process.stdout.write(event.delta.text);
    }
  }

  const finalMsg = await stream.finalMessage();
  const inputTokens = finalMsg.usage.input_tokens;
  const outputTokens = finalMsg.usage.output_tokens;

  console.log(`\n\n${YELLOW}---${RESET}`);
  console.log(`${GREEN}Done.${RESET} Tokens used: ${inputTokens} in / ${outputTokens} out`);
  console.log(`Estimated cost: $${((inputTokens * 5 + outputTokens * 25) / 1_000_000).toFixed(4)}\n`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
