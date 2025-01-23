console.clear();

import dotenv from 'dotenv';

dotenv.config();

import { run_demo_loop, } from '../../src/index.js';
import { triage_agent, } from './agents.js';

run_demo_loop(triage_agent);
