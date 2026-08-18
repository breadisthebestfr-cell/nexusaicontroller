// Builds the MCP server and registers the four tools, delegating to tools.ts.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  ToolContext,
  askModel,
  configFromEnv,
  listInstances,
  listModels,
  notify,
  runTask,
  type RoleModel,
  type ToolsConfig
} from './tools'
import { pickBestModel } from '../shared/modelRanking'

const roleModel = z.object({
  baseUrl: z.string().describe('Base URL of the Ollama instance, e.g. http://192.168.1.20:11434'),
  model: z.string().describe('Model tag, e.g. qwen2.5-coder:7b')
})

// A role can be an explicit model or the string "auto" to auto-pick the best available.
const roleOrAuto = z.union([roleModel, z.literal('auto')])

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export function buildServer(config: ToolsConfig = configFromEnv()): McpServer {
  const ctx = new ToolContext(config)
  const server = new McpServer({ name: 'localaiconnection', version: '0.1.0' })

  server.registerTool(
    'list_instances',
    {
      title: 'List local Ollama instances',
      description:
        'Discover Ollama instances on the local machine and LAN (plus any pinned hosts). Returns id, ' +
        'base URL, version, and model count for each. Results are cached briefly; pass rescan=true to refresh.',
      inputSchema: { rescan: z.boolean().optional().describe('Force a fresh network scan') }
    },
    async ({ rescan }) => jsonResult(await listInstances(ctx, rescan ?? false))
  )

  server.registerTool(
    'list_models',
    {
      title: 'List available local models',
      description:
        'List every model across discovered instances (or one instance if `instance` is given). Each entry ' +
        'includes the baseUrl + model you pass to ask_model or run_multi_agent_task.',
      inputSchema: {
        instance: z.string().optional().describe('Filter to one instance by id ("host:port") or baseUrl')
      }
    },
    async ({ instance }) => jsonResult(await listModels(ctx, instance))
  )

  server.registerTool(
    'ask_model',
    {
      title: 'Ask a local model',
      description: 'Send a single prompt to one local model and return its full text reply.',
      inputSchema: {
        baseUrl: z.string().describe('Base URL of the Ollama instance'),
        model: z.string().describe('Model tag to use'),
        prompt: z.string().describe('The user prompt'),
        system: z.string().optional().describe('Optional system prompt')
      }
    },
    async (args) => {
      try {
        return jsonResult({ reply: await askModel(args) })
      } catch (err) {
        return errorResult(`ask_model failed: ${(err as Error).message}`)
      }
    }
  )

  server.registerTool(
    'run_multi_agent_task',
    {
      title: 'Run a multi-agent coding task',
      description:
        'Run the planner -> coder -> reviewer collaboration over local models against a project folder. ' +
        'The coder writes files INTO projectRoot (sandboxed to that folder). Only `coder` is required; ' +
        'add `reviewer` to enable the review/iterate loop. Any role may be the string "auto" to ' +
        'auto-pick the strongest available model (coder prefers coding-tuned models). Returns a summary, ' +
        'the files written, and the full transcript.',
      inputSchema: {
        task: z.string().describe('What to build'),
        projectRoot: z.string().describe('Absolute path to the folder agents may write into'),
        coder: roleOrAuto.describe('Model that writes the files, or "auto" (required)'),
        planner: roleOrAuto.optional().describe('Model that drafts the plan, or "auto"'),
        reviewer: roleOrAuto.optional().describe('Model that reviews and requests fixes, or "auto"'),
        maxRounds: z.number().int().min(1).max(10).optional().describe('Max coder/reviewer rounds (default 3)')
      }
    },
    async (args) => {
      try {
        const resolve = async (
          choice: RoleModel | 'auto' | undefined,
          preferCoding: boolean
        ): Promise<RoleModel | undefined> => {
          if (!choice) return undefined
          if (choice !== 'auto') return choice
          const best = pickBestModel(await ctx.getInstances(), { preferCoding })
          if (!best) throw new Error('no online models available for "auto" selection')
          return { baseUrl: best.baseUrl, model: best.model }
        }
        const coder = await resolve(args.coder, true)
        if (!coder) throw new Error('coder is required')
        return jsonResult(
          await runTask({
            task: args.task,
            projectRoot: args.projectRoot,
            coder,
            planner: await resolve(args.planner, false),
            reviewer: await resolve(args.reviewer, false),
            maxRounds: args.maxRounds
          })
        )
      } catch (err) {
        return errorResult(`run_multi_agent_task failed: ${(err as Error).message}`)
      }
    }
  )

  server.registerTool(
    'notify',
    {
      title: 'Send a Discord notification',
      description:
        'Post a message to the user\'s Discord via their configured webhook (env LOCALAI_DISCORD_WEBHOOK). ' +
        'Use this to send the user progress, questions, or results while they are away. Returns sent:false ' +
        'if no webhook is configured.',
      inputSchema: {
        message: z.string().describe('The message to send'),
        level: z.enum(['info', 'success', 'warn', 'error']).optional().describe('Severity (default info)')
      }
    },
    async ({ message, level }) => jsonResult(await notify(message, level ?? 'info'))
  )

  return server
}
