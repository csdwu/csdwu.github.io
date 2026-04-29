const fs = require('fs');
const html = fs.readFileSync('_site/embedded-ai.html', 'utf8');

// 统计venue badge
const arxivSpans = html.match(/<span class="embedded-ai-venue embedded-ai-venue--arxiv">arXiv<\/span>/g);
const totalVenue = html.match(/<span class="embedded-ai-venue[^"]*">/g);

console.log('=== Venue Badge Statistics ===');
console.log('arXiv venue badges:', arxivSpans ? arxivSpans.length : 0);
console.log('Total venue badges:', totalVenue ? totalVenue.length : 0);

// 显示前几个venue badge示例
const examples = html.match(/<span class="embedded-ai-venue[^"]*">[^<]+<\/span>/g);
console.log('\nFirst 15 venue badge examples:');
examples.slice(0, 15).forEach((e, i) => console.log((i+1) + ': ' + e));

// 验证没有两个连续的venue badge（确保没有重复显示）
const doubleBadges = html.match(/<\/span><span class="embedded-ai-venue/g);
console.log('\nDouble consecutive venue badges:', doubleBadges ? doubleBadges.length : 0);

// 检查一些具体的论文项，确保格式正确
console.log('\n=== Sample Paper Items ===');
const paperItems = html.match(/<li class="embedded-ai-paper-item"[^>]*>[\s\S]*?<\/li>/g);
if (paperItems) {
  for (let i = 0; i < Math.min(3, paperItems.length); i++) {
    const item = paperItems[i];
    const hasTag = /<span class="embedded-ai-tag/.test(item);
    const hasVenue = /<span class="embedded-ai-venue/.test(item);
    const hasDate = /<span class="embedded-ai-paper-date/.test(item);
    const venueBadges = item.match(/<span class="embedded-ai-venue[^"]*">[^<]+<\/span>/g);
    
    console.log(`\nPaper ${i+1}:`);
    console.log('  - Has topic tag:', hasTag);
    console.log('  - Has venue badge:', hasVenue);
    console.log('  - Venue badges count:', venueBadges ? venueBadges.length : 0);
    if (venueBadges) {
      venueBadges.forEach((v, j) => console.log(`    ${j+1}. ${v}`));
    }
    console.log('  - Has date:', hasDate);
  }
}
