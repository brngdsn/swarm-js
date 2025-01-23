import fs from 'fs/promises';
import OpenAI from 'openai';
import ora from 'ora';
import chalk from 'chalk';

const type_map = new Map([
    [String, 'string'],
    [Number, 'number'],   // JSON Schema 'number' covers both int + float
    [Boolean, 'boolean'],
    [Array, 'array'],
    [Object, 'object'],
    // There's no direct constructor for "null" in JS.
    // If you need to handle null, you'll need a different strategy.
]);
  
function parse_parameters_from_string (fn_str) {
    // This regex looks for something like: "function foo(...) {" or "(...) => ...".
    // It captures the parameter contents in the first parentheses group.
    // It will fail for destructured parameters, rest/spread parameters, etc.
    const match = fn_str.match(/^[^(]*\(\s*([^)]*)\)/);
    if (!match) return [];
  
    // Split on commas, then trim each parameter piece
    return match[1]
      .split(',')
      .map(param => param.trim())
      .filter(Boolean);
}

function function_to_schema (func, annotation_map = {}) {
    if (typeof func !== 'function') {
      throw new TypeError(`Expected a function, got ${typeof func}`);
    }
  
    // 1. Extract function name
    const name = func.name || 'anonymous';
  
    // 2. Extract a "docstring" if you stored one manually, e.g. `func.doc = "..."`
    //    There's no standard docstring in JS, so we rely on a custom property here.
    const description = typeof func.doc === 'string' ? func.doc : '';
  
    // 3. Attempt to parse parameter names from the function's string.
    const fn_str = func.toString();
    const raw_params = parse_parameters_from_string(fn_str);
  
    // 4. Build up "parameters" and "required" arrays
    const parameters = {};
    const required = [];
  
    for (const raw_param of raw_params) {
      // If the parameter has a default, e.g. "x = 42", split it out.
      const [param_name, default_value] = raw_param.split('=').map(s => s.trim());
  
      // Figure out the type (default to "string" if none provided)
      let js_type = annotation_map[param_name] || String; // default to String
      let schema_type = type_map.get(js_type) || 'string';
  
      // You might detect if `default_value` is a numeric literal, boolean literal, etc.
      // But this is strictly optional and naive.
      parameters[param_name] = { type: schema_type };
  
      // If no default, mark parameter as required
      if (default_value === undefined) {
        required.push(param_name);
      }
    }
  
    // 5. Return the schema-like object
    return {
      type: 'function',
      function: {
        name,
        description,
        parameters: {
          type: 'object',
          properties: parameters,
          required
        }
      }
    };
}

export class Agent {
    name = "Agent";
    model = "gpt-4o-mini";
    instructions = "You are a helpful Agent";
    tools = [];
    constructor({ name, model, instructions, tools, } = {}) {
        if (name !== undefined) this.name = name;
        if (model !== undefined) this.model = model;
        if (instructions !== undefined) this.instructions = instructions;
        if (tools !== undefined) this.tools = tools;
    }
    describe () {
        return this.name;
    }
    static is_agent (obj) {
        return obj instanceof Agent;
    }
}

class Response {
    agent = undefined;
    messages = [];
    constructor({
        agent,
        messages,
    } = {}) {
        if (agent !== undefined) this.agent = agent;
        if (messages !== undefined) this.messages = messages;
    }
}

const {
    OPENAI_API_KEY,
} = process.env;

export class SwarmJS {
    spinner = ora({
        text: chalk.blue('Starting application...'),
        color: 'blue',
    }).start();
    constructor ({ openai = new OpenAI({ apiKey: OPENAI_API_KEY, }), } = {}, ) {
        this.openai = openai;
    }
    async execute_tool_call (tool_call, tools_map) {
        const {
            function: {
                name: function_name,
                arguments: function_arguments,
            },
        } = tool_call;
        const $function = tools_map[function_name];
        console.log(chalk.magenta(`${function_name}(${function_arguments})`));
        this.spinner.start(chalk.blue(`Executing tool_call: ${function_name}`));
        return await $function(JSON.parse(function_arguments));
    }
    async run (
        agent = new Agent(),
        messages = []
    ) {
        try {
            this.spinner.start(chalk.blue('Starting chat with OpenAI...'));
            let current_agent = agent;
            while (true) {
                let tool_schemas = current_agent.tools.map(tool => function_to_schema(tool));
                let tools_map = Object.fromEntries(current_agent.tools.map(tool => [tool.name, tool]));
                const chat = await this.openai.chat.completions.create({
                    model: current_agent.model,
                    messages: [
                        {
                            role: `system`,
                            content: current_agent.instructions,
                        },
                        ...messages
                    ],
                    tools: tool_schemas,
                });
    
                const { choices: [{ message, }], } = chat;
                messages.push(message);
                const { tool_calls, content, } = message;
                if (content) {
                    this.spinner.succeed(chalk.green(content));
                }
                if (!tool_calls) {
                    this.spinner.succeed(chalk.green(`The model didn't use any more tools.`));
                    break;
                }
                for (const tool_call of tool_calls) {
                    try {
                        let tool_result = await this.execute_tool_call(tool_call, tools_map);
                        if (Agent.is_agent(tool_result)) {
                            current_agent = tool_result;
                            tool_result = `Transfered to ${current_agent.name}. Adopt persona immediately.`;
                            console.log(chalk.bgGreen.bold(tool_result));
                            messages.push({
                                role: 'tool',
                                tool_call_id: tool_call.id,
                                content: tool_result,
                            });
                        } else {
                            const result = JSON.stringify(tool_result, null, 2);
                            console.log(chalk.bgGreen.bold(result));
                            messages.push({
                                role: 'tool',
                                tool_call_id: tool_call.id,
                                content: result,
                            });
                        }
                    } catch (tool_call_error) {
                        this.spinner.fail(chalk.red(`Error executing tool ${tool_call.name}: ${tool_call_error.message}`));
                    }
                }
            }
            return new Response({ agent: current_agent, messages, });
        } catch (error) {
            this.spinner.fail(chalk.red(`An error occurred in \`run_multi_agent\`: ${error.message}`));
            return messages;
        } finally {
            this.spinner.info(chalk.blue('Application finished execution.'));
            this.spinner.stop();
        }
    }
}

export async function run_demo_loop (initial_agent) {
    let swarm;
    try {
        swarm = new SwarmJS();
        let agent = initial_agent;
        let messages = [{
            role: `user`,
            content: `
                I would like to return a christmas tree.
            `,
        }];
        const response = await swarm.run(
            agent,
            messages,
        );
        agent = response.agent;
        messages = [...response.messages];
        await fs.writeFile(`eg-run.md`, JSON.stringify(messages, null, 2), 'utf-8');
    } catch (error) {
        console.log(chalk.red(`An unhandled error occurred: ${error.message}`));
    }
}
