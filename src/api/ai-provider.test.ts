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
