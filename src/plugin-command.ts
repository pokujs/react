import type { BuildRunnerCommandInput } from '@pokujs/dom';
import type { ReactDomAdapter } from './plugin-types.ts';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunnerCommand as buildCoreRunnerCommand,
  canHandleRuntime,
  createDomSetupPathResolver,
} from '@pokujs/dom';

const currentDir = dirname(fileURLToPath(import.meta.url));

const resolveSetupModulePath = (baseName: string) => {
  const jsPath = resolve(currentDir, `${baseName}.js`);
  if (existsSync(jsPath)) return jsPath;
  return resolve(currentDir, `${baseName}.ts`);
};

const happyDomSetupPath = resolveSetupModulePath('dom-setup-happy');
const jsdomSetupPath = resolveSetupModulePath('dom-setup-jsdom');

const reactExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

export const resolveDomSetupPath = createDomSetupPathResolver(
  '@pokujs/react',
  happyDomSetupPath,
  jsdomSetupPath
);

export const buildRunnerCommand = (
  input: Omit<BuildRunnerCommandInput, 'extensions'>
) => buildCoreRunnerCommand({ ...input, extensions: reactExtensions });

export { canHandleRuntime };
