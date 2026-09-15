import { describe, expect, it } from 'vitest';
import { extractDefinitionFromLlm } from './ai-provider';

describe('extractDefinitionFromLlm', () => {
  it('extracts Chinese definition from standard word template output', () => {
    const markdown = `# word

**[wɜːd]**

n.

## 释义
**a single distinct meaningful element of speech or writing**

单词；话语

He spoke not a word. (他一句话也没说。)

## 词根
无明显词根拆解

## 扩展
- 同义词: term, vocabulary
- 反义词: silence
- 搭配: in a word
`;
    expect(extractDefinitionFromLlm(markdown, 'word')).toBe('单词；话语');
  });

  it('extracts definition from the new "# word [IPA] 翻译" first-line format', () => {
    const markdown = `# pirate /ˈpaɪrət/ n. 海盗；盗版者

## 词根与速记
- 词根解析: 来自希腊语 peiran（尝试、冒险）, 引申为海上冒险劫掠的人。
- 快速记忆: 谐音“拍了它”——海盗抢了宝物赶紧“拍了它”。

## 实用例句
The pirates buried their treasure on a secret island.
海盗们把财宝埋在一座秘密岛屿上。

## 近义与反义
- 近义词: buccaneer /ˌbʌkəˈnɪə/ 海盗
- 反义词: 无
`;
    expect(extractDefinitionFromLlm(markdown, 'pirate')).toBe('n. 海盗；盗版者');
  });

  it('strips "查询：word" header and extracts definition', () => {
    const markdown = `# 查询：word

**[wɜːd]**

n. 单词

## 释义
中文释义：单词，话语

例句：He kept his word. (他遵守诺言。)
`;
    expect(extractDefinitionFromLlm(markdown, 'word')).toBe('单词，话语');
  });

  it('extracts from study review card table', () => {
    const markdown = `### 📌 1. 核心单词卡片

| 属性 | 内容 |
| :--- | :--- |
| **单词 (音标)** | **word** \`[wɜːd]\` |
| **级别 / 词性** | B1 / n. |
| **当前语境释义** | **结合语境的精准中文释义：单词，字** |
| **常用核心释义** | 话语，言语 |
`;
    expect(extractDefinitionFromLlm(markdown, 'word')).toBe('单词，字');
  });

  it('extracts sentence translation from sentence template', () => {
    const markdown = `**这是一句用于测试的完整中文翻译。**

## 语法点
1. 主谓宾结构说明

## 讲解
语境语气分析说明
`;
    expect(extractDefinitionFromLlm(markdown)).toBe(
      '这是一句用于测试的完整中文翻译。',
    );
  });

  it('cleans simple translation string with prefixes', () => {
    expect(extractDefinitionFromLlm('词：单词', 'word')).toBe('单词');
    expect(extractDefinitionFromLlm('单词：话语', 'word')).toBe('话语');
    expect(extractDefinitionFromLlm('查询：单词', 'word')).toBe('单词');
    expect(extractDefinitionFromLlm('待查内容：单词', 'word')).toBe('单词');
    expect(extractDefinitionFromLlm('Query: word\n释义：单词', 'word')).toBe('单词');
    expect(extractDefinitionFromLlm('# 待查内容：word\n\n## 释义\n单词；话语', 'word')).toBe('单词；话语');
    expect(extractDefinitionFromLlm('待查内容：word\n核心释义：单词', 'word')).toBe('单词');
    expect(extractDefinitionFromLlm('# word\n\n## 释义\n单词\n\n上下文：这是一句字幕的翻译。', 'word')).toBe('单词');
    expect(extractDefinitionFromLlm('上下文：这是一句字幕的翻译。\n单词：测试', 'word')).toBe('测试');
  });

  it('correctly handles AI translation output with context and word prefixes', () => {
    const aiOutput1 = `上下文：“xxxx”\n单词：法语\n上下文：xxxx`;
    expect(extractDefinitionFromLlm(aiOutput1, 'French')).toBe('法语');

    const aiOutput2 = `上下文：xxxx\n单词：法语\n上下文：xxxx`;
    expect(extractDefinitionFromLlm(aiOutput2, 'French')).toBe('法语');

    const aiOutput3 = `- 上下文：xxxx\n- 单词：法语\n- 上下文：xxxx`;
    expect(extractDefinitionFromLlm(aiOutput3, 'French')).toBe('法语');

    const aiOutput4 = `**上下文**：xxxx\n**单词**：法语\n**上下文**：xxxx`;
    expect(extractDefinitionFromLlm(aiOutput4, 'French')).toBe('法语');

    const aiOutput5 = `【上下文】xxxx\n【单词】法语\n【上下文】xxxx`;
    expect(extractDefinitionFromLlm(aiOutput5, 'French')).toBe('法语');

    const aiOutput6 = `上下文: "xxxx"\n单词: 法语`;
    expect(extractDefinitionFromLlm(aiOutput6, 'French')).toBe('法语');

    const aiOutput7 = `上下文：“I like French food.”\n单词：法语\n上下文：我喜欢法国菜。`;
    expect(extractDefinitionFromLlm(aiOutput7, 'French')).toBe('法语');

    const aiOutput8 = `French: 法语\n上下文：xxxx`;
    expect(extractDefinitionFromLlm(aiOutput8, 'French')).toBe('法语');
  });
});

describe('getWordExplainPrompt', () => {
  it('generates clean word explain prompt without broken templates', async () => {
    const { getWordExplainPrompt } = await import('../utils/prompts/word-explain');
    const prompt = getWordExplainPrompt('en', 'zh-cn', 'intermediate');
    expect(prompt).toContain('Simplified Chinese (简体中文)');
    expect(prompt).toContain('intermediate');
    expect(prompt).not.toContain('{{%');
    expect(prompt).not.toContain('{{ definition in');
  });
});
