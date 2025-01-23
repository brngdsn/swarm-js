import { Agent, } from '../../src/index.js';

look_up_item.doc = `Use to find an item ID. Search query can be a description or keywords.`;
function look_up_item (search_query) {
    return "item_00000";
}

execute_refund.doc = `Use to issue a refund by item ID.`;
function execute_refund (item_id, reason = "not provided") {
    console.log(`Summary: ${item_id}; ${reason};`)
    return "Success";
}

export const triage_agent = new Agent({
    name: `Triage Agent`,
    model: `gpt-4o-mini`,
    instructions: `
        Analyze the user's request and determine the appropriate course of action.
        - If the request involves a refund, first obtain the item ID from the Inventory Agent.
        - After obtaining the item ID, transfer to the Refunds Agent to process the refund.
        - Ensure that all necessary information is gathered before processing.
    `,
    tools: [ transfer_to_inventory_agent, transfer_to_refunds_agent, ],
});

const inventory_agent = new Agent({
    name: `Inventory Agent`,
    model: `gpt-4o-mini`,
    instructions: `
        Assist with finding item IDs for refunding items, then transfer back to triage.
    `,
    tools: [ look_up_item, transfer_back_to_triage, ],
});

const refunds_agent = new Agent({
    name: `Refunds Agent`,
    model: `gpt-4o-mini`,
    instructions: `
        Assist with issuing refunds using an item ID, then transfer back to triage.
    `,
    tools: [ execute_refund, transfer_back_to_triage, ],
});

transfer_back_to_triage.doc = `
    Call this function if a user is asking about a topic 
    that is not handled by the current agent.
`;
function transfer_back_to_triage () {
    return triage_agent;
}

transfer_to_inventory_agent.doc = `Transfers to the Inventory Agent.`;
function transfer_to_inventory_agent () {
    return inventory_agent;
}

transfer_to_refunds_agent.doc = `Transfers to the Refunds Agent.`
function transfer_to_refunds_agent () {
    return refunds_agent;
}