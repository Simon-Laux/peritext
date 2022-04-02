import { createEditor, initializeDocs } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change, InputOperation } from "./micromerge"
import type { Editor } from "./bridge"
import { Mark } from "prosemirror-model"
import Micromerge from "./micromerge"

import type { Webxdc, ReceivedStatusUpdate } from "../webxdc"

const publisher = new Publisher<Array<Change>>()

let editor: Editor | undefined

const renderMarks = (domNode: Element, marks: Mark[]): void => {
    domNode.innerHTML = marks
        .map(m => `• ${m.type.name} ${Object.keys(m.attrs).length !== 0 ? JSON.stringify(m.attrs) : ""}`)
        .join("<br/>")
}

type stateUpdate = Change[]

const webxdc = window.webxdc as Webxdc<stateUpdate>

const local_actor_id = webxdc.selfAddr

const aliceDoc = new Micromerge(local_actor_id)

// init docs, without it editor can not be used

const theVoid = new Micromerge("the_void")
const inputOps: InputOperation[] = [
    { path: [], action: "makeList", key: Micromerge.contentKey },
    {
        path: [Micromerge.contentKey],
        action: "insert",
        index: 0,
        values: [""],
    },
]
const { change: initialChange } = theVoid.change(inputOps)
console.log(JSON.stringify(initialChange))

//aliceDoc.applyChange(initialChange)
aliceDoc.applyChange(JSON.parse(JSON.stringify(initialChange)))

function update(fastForward: boolean, update: ReceivedStatusUpdate<stateUpdate>) {
    for (const change of update.payload) {
        // local actor should be ignored when not fast forwarding,
        // because micromerge already has that state update and does not accept it a second time
        if (fastForward || change.actor !== local_actor_id) {
            console.info("apply", change)

            aliceDoc.applyChange(change)
        }
    }
}

let started = false
webxdc.setUpdateListener(state_update => {
    if (started) {
        update(false, state_update)
    } else {
        update(true, state_update)
        if (state_update.serial == state_update.max_serial) {
            started = true
        }
    }
}, 0)

publisher.subscribe("webxdc", changes => {
    // TODO solve that this is somehow called in a loop
    console.log("publishing", { changes })
    if (changes.length == 0) {
        console.log("no change to publish")
    } else {
        started = true
        webxdc.sendUpdate({ payload: changes }, "update state of document")
    }
})

const aliceNode = document.querySelector("#the-editor")
const aliceEditor = aliceNode?.querySelector(".editor")
const aliceChanges = aliceNode?.querySelector(".changes")
const aliceMarks = aliceNode?.querySelector(".marks")

if (aliceNode && aliceEditor && aliceChanges && aliceMarks) {
    editor = createEditor({
        actorId: local_actor_id,
        editorNode: aliceEditor,
        changesNode: aliceChanges,
        doc: aliceDoc,
        publisher,
        editable: true,
        handleClickOn: (view, pos, node, nodePos, event, direct) => {
            // Prosemirror calls this once per node that overlaps w/ the clicked pos.
            // We only want to run our callback once, on the innermost clicked node.
            if (!direct) return false

            const marksAtPosition = view.state.doc.resolve(pos).marks()
            renderMarks(aliceMarks, marksAtPosition)
            return false
        },
    })
} else {
    throw new Error(`Didn't find expected node in the DOM`)
}

editor?.queue.drop()

document.querySelector("#sync")?.addEventListener("click", () => {
    editor?.queue.flush()
})
