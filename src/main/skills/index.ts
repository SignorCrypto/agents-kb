import fs from 'fs';
import path from 'path';
import os from 'os';
import { ipcMain } from 'electron';
import type { Skill } from '../../shared/types';
import { getProjects } from '../store';

const SKILL_FILENAME = 'SKILL.md';

// In-memory cache of skills reported by running sessions (keyed by project path)
const skillsCache = new Map<string, Skill[]>();

export function setSkillsCache(projectPath: string, skills: Skill[]): void {
  skillsCache.set(projectPath, skills);
}

function skillKey(skill: Pick<Skill, 'source' | 'name'>): string {
  return `${skill.source}:${skill.name}`;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && val) fields[key] = val;
  }
  return fields;
}

function readSkillsFromDir(dir: string, source: Skill['source']): Skill[] {
  if (!fs.existsSync(dir)) return [];

  const skills: Skill[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillFile = path.join(dir, entry, SKILL_FILENAME);
    try {
      const stat = fs.statSync(path.join(dir, entry));
      if (!stat.isDirectory()) continue;

      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf-8');
      const fm = parseFrontmatter(content);

      skills.push({
        name: fm.name || entry,
        description: fm.description || '',
        source,
        filePath: skillFile,
      });
    } catch {
      // Skip unreadable entries
    }
  }

  return skills;
}

function mergeSkills(cached: Skill[], projectSkills: Skill[], globalSkills: Skill[]): Skill[] {
  const merged = new Map<string, Skill>();

  for (const skill of cached) {
    if (skill.filePath) {
      if (!fs.existsSync(skill.filePath)) continue;
    } else if (skill.source === 'project') {
      // Project skills are always filesystem-backed; if the source file is gone
      // and the SDK did not provide a path, treat the entry as stale.
      continue;
    }

    merged.set(skillKey(skill), skill);
  }

  for (const skill of projectSkills) {
    merged.set(skillKey(skill), skill);
  }

  for (const skill of globalSkills) {
    merged.set(skillKey(skill), skill);
  }

  return [...merged.values()];
}

export function listSkills(projectPath?: string): Skill[] {
  const globalDir = path.join(os.homedir(), '.claude', 'skills');
  const globalSkills = readSkillsFromDir(globalDir, 'global');

  let projectSkills: Skill[] = [];
  if (projectPath) {
    const projectDir = path.join(projectPath, '.claude', 'skills');
    projectSkills = readSkillsFromDir(projectDir, 'project');
  }

  const cached = projectPath ? skillsCache.get(projectPath) ?? [] : [];
  return mergeSkills(cached, projectSkills, globalSkills);
}

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:list', (_event, projectId?: string) => {
    const projectPath = projectId
      ? getProjects().find((project) => project.id === projectId)?.path
      : undefined;
    return listSkills(projectPath);
  });
}
