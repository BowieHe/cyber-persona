import cron from 'node-cron';
import type { ChatService } from './chat-service.js';

let isRunning = false;

/**
 * 获取 GitHub Trending（本周热门 AI 项目）- 完全免费
 */
async function getGitHubTrending(): Promise<string[]> {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const dateStr = oneWeekAgo.toISOString().split('T')[0];

    const response = await fetch(
      `https://api.github.com/search/repositories?q=ai+OR+llm+OR+claude+OR+agent+created:>${dateStr}&sort=stars&order=desc`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {})
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.items.slice(0, 5).map((repo: any) =>
      `⭐ ${repo.full_name}: ${repo.description?.substring(0, 60) || 'No description'} (${repo.stargazers_count} stars)`
    );
  } catch (err) {
    console.error('[Cron] GitHub Trending 获取失败:', err);
    return ['GitHub Trending 暂时不可用'];
  }
}

/**
 * 获取 Reddit r/MachineLearning 热门帖子 - 完全免费
 */
async function getRedditTrending(): Promise<string[]> {
  try {
    const response = await fetch(
      'https://www.reddit.com/r/MachineLearning+LocalLLaMA+ClaudeAI/hot.json?limit=10',
      {
        headers: {
          'User-Agent': 'cyber-persona-bot/0.1 (by /u/yourusername)'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const posts = data.data?.children || [];

    return posts
      .filter((post: any) => !post.data.stickied)
      .slice(0, 5)
      .map((post: any) => {
        const title = post.data.title;
        const score = post.data.score;
        const subreddit = post.data.subreddit;
        return `📌 [${subreddit}] ${title} (👍 ${score})`;
      });
  } catch (err) {
    console.error('[Cron] Reddit 获取失败:', err);
    return ['Reddit 暂时不可用'];
  }
}

/**
 * 获取 Hacker News 热门（AI 相关）- 完全免费
 */
async function getHackerNews(): Promise<string[]> {
  try {
    const topResponse = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topIds = await topResponse.json() as number[];

    const stories = await Promise.all(
      topIds.slice(0, 20).map(async (id) => {
        const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return res.json();
      })
    );

    const aiKeywords = ['ai', 'llm', 'gpt', 'claude', 'openai', 'anthropic', 'model', 'ml', 'neural'];
    const aiStories = stories
      .filter((s: any) => {
        const title = s?.title?.toLowerCase() || '';
        return aiKeywords.some(kw => title.includes(kw));
      })
      .slice(0, 5)
      .map((s: any) => `💻 ${s.title} (👍 ${s.score})`);

    return aiStories.length > 0 ? aiStories : ['暂无 AI 相关的 HN 热门'];
  } catch (err) {
    console.error('[Cron] Hacker News 获取失败:', err);
    return ['Hacker News 暂时不可用'];
  }
}

/**
 * 构建 AI Trend 报告
 */
async function buildTrendReport(chatService: ChatService): Promise<string> {
  console.log('[Cron] 正在收集趋势数据...');

  const [githubTrends, redditTrends, hnTrends] = await Promise.all([
    getGitHubTrending(),
    getRedditTrending(),
    getHackerNews()
  ]);

  const report = [
    '📊 今日 AI 趋势报告',
    '',
    '🐙 GitHub Trending:',
    ...githubTrends.map(t => `  ${t}`),
    '',
    '📱 Reddit 热门:',
    ...redditTrends.map(t => `  ${t}`),
    '',
    '🗞️ Hacker News:',
    ...hnTrends.map(t => `  ${t}`),
  ].join('\n');

  console.log('[Cron] 趋势数据收集完成');

  try {
    const result = await chatService.buildReply(
      `根据以下今日 AI 趋势数据，生成一份简洁的摘要报告，突出最重要的 2-3 个趋势：\n\n${report}`,
      { sessionId: 'cron-daily-trend', personaId: 'bowie' }
    );
    return result.reply;
  } catch (err) {
    return report;
  }
}

export function initCronJobs(chatService: ChatService): void {
  if (process.env.ENABLE_CRON !== 'true') {
    return;
  }

  console.log('[Cron] 定时任务已启用');

  // 每2分钟发送测试消息
  // TODO: 后续改为每天早上9点: '0 9 * * *'
  cron.schedule('*/2 * * * *', async () => {
    if (isRunning) {
      console.log('[Cron] 上一次任务还未完成，跳过');
      return;
    }

    isRunning = true;
    console.log('[Cron] 执行定时任务...');

    try {
      const report = await buildTrendReport(chatService);

      console.log('[Cron] AI Trend 报告生成完成');
      console.log('[Cron] 结果预览:', report.substring(0, 300) + '...');

    } catch (err) {
      console.error('[Cron] 任务失败:', err);
    } finally {
      isRunning = false;
    }
  });

  console.log('[Cron] 定时任务已注册 (每2分钟执行一次)');
}
