import React from 'react';
import type { SkillRecord } from '../../db/schema';
import { SkillsPage } from './Skills';
import { sendRuntime } from '../../shared/messaging/client';

/** read-frog Custom Actions → 本项目 Skills */
export function CustomActionsPage(props: {
  skills: SkillRecord[];
  onChanged: () => Promise<void>;
}) {
  return (
    <div>
      <h1 className="page-title">自定义 AI 指令</h1>
      <p className="page-desc">
        内置 Skill 首次启动自动写入，名称与提示词可随时修改且不会被升级覆盖；也支持新建自定义指令。
      </p>
      <SkillsPage
        skills={props.skills}
        onSave={async (skill) => {
          await sendRuntime('skill.save', skill, 'options');
          await props.onChanged();
        }}
        onDelete={async (id) => {
          await sendRuntime('skill.delete', { id }, 'options');
          await props.onChanged();
        }}
        onResetBuiltin={async (id) => {
          await sendRuntime('skill.resetBuiltin', { id }, 'options');
          await props.onChanged();
        }}
      />
    </div>
  );
}
