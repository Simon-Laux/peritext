import Automerge from "automerge"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Slice, Node, ResolvedPos } from "prosemirror-model"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { schemaSpec } from "./schema"
import type { FormatOp, ResolvedOp } from "./operations"
import sortBy from "lodash/sortBy"
import { replayOps } from "./format"

const editorNode = document.querySelector("#editor")
const schema = new Schema(schemaSpec)

const richTextKeymap = {
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
}

type RichTextDoc = {
    content: Automerge.Text
    formatOps: Automerge.List<FormatOp>
}

let doc = Automerge.from<RichTextDoc>({
    content: new Automerge.Text("Welcome to the Peritext editor!"),
    formatOps: [],
})

/**
 * Converts a position in the Prosemirror doc to an offset in the Automerge content string.
 * For now we only have a single node so this is relatively trivial.
 * When things get more complicated with multiple nodes, we can probably take advantage
 * of the additional metadata that Prosemirror can provide by "resolving" the position.
 * @param position : an unresolved Prosemirror position in the doc;
 * @returns
 */
function contentPosFromProsemirrorPos(position: number) {
    return position - 1
}

// A simple stub for producing a PM doc from an Automerge doc.
// Just temporary while the actual version is work-in-progress.
function simpleProsemirrorDocFromAutomergeDoc(doc: RichTextDoc) {
    return schema.node("doc", undefined, [
        schema.node("paragraph", undefined, [
            // schema.text(doc.content.toString(), [schema.mark("strong")]),
            schema.text(doc.content.toString()),
        ]),
    ])
}

function resolveOp(op: FormatOp): ResolvedOp {
    return { ...op, start: op.start.index, end: op.end.index }
}

// Given an automerge doc representation, produce a prosemirror doc.
// In the future, will handle fancier stuff like formatting.
function prosemirrorDocFromAutomergeDoc(doc: RichTextDoc) {
    const textContent = doc.content.toString()
    const formatSpans = replayOps(
        doc.formatOps.map(resolveOp),
        textContent.length
    )

    console.log("flattened format spans:")
    console.table(
        formatSpans.map(span => ({
            start: span.start,
            marks: [...span.marks].join(", "),
        }))
    )

    const textNodes = formatSpans.map((span, index) => {
        // We only store start positions on spans;
        // look to the next span to figure out when this span ends.
        let spanEnd
        if (index < formatSpans.length - 1) {
            spanEnd = formatSpans[index + 1].start
        } else {
            spanEnd = textContent.length
        }

        if (span.start === spanEnd) {
            console.error("empty text node!?", span)
        }

        return schema.text(
            textContent.slice(span.start, spanEnd),
            [...span.marks].map(markType => schema.mark(markType))
        )
    })

    // console.log("flattened text nodes:")
    // console.table(
    //     textNodes.map(node => ({
    //         text: node.text,
    //         marks: node.marks.map(mark => mark.toJSON().type).join(", "),
    //     }))
    // )

    const result = schema.node("doc", undefined, [
        schema.node("paragraph", undefined, textNodes),
    ])

    // console.log("prosemirror doc", result)

    return result
}

// Given an Automerge Doc and a Prosemirror Transaction, return an updated Automerge Doc
// Note: need to derive a PM doc from the new Automerge doc later!
// TODO: why don't we need to update the selection when we do insertions?
function applyTransaction(doc: RichTextDoc, txn: Transaction): RichTextDoc {
    let newDoc = doc

    txn.steps.forEach(_step => {
        const step = _step.toJSON()

        console.log("step", step)

        switch (step.stepType) {
            case "replace": {
                if (step.slice) {
                    // handle insertion
                    if (step.from !== step.to) {
                        newDoc = Automerge.change(doc, doc => {
                            if (doc.content.deleteAt) {
                                doc.content.deleteAt(
                                    contentPosFromProsemirrorPos(step.from),
                                    step.to - step.from
                                )
                            }
                        })
                    }

                    const insertedContent = step.slice.content
                        .map(c => c.text)
                        .join("")

                    newDoc = Automerge.change(doc, doc => {
                        if (doc.content.insertAt) {
                            doc.content.insertAt(
                                contentPosFromProsemirrorPos(step.from),
                                insertedContent
                            )
                        }
                    })
                } else {
                    // handle deletion
                    newDoc = Automerge.change(doc, doc => {
                        if (doc.content.deleteAt) {
                            doc.content.deleteAt(
                                contentPosFromProsemirrorPos(step.from),
                                step.to - step.from
                            )
                        }
                    })
                }
                break
            }

            case "addMark": {
                newDoc = Automerge.change(doc, doc => {
                    doc.formatOps.push({
                        type: "addMark",
                        markType: step.mark.type,
                        start: doc.content.getCursorAt(
                            contentPosFromProsemirrorPos(step.from)
                        ),
                        end: doc.content.getCursorAt(
                            contentPosFromProsemirrorPos(step.to)
                        ),
                    })
                })

                break
            }

            case "removeMark": {
                newDoc = Automerge.change(doc, doc => {
                    doc.formatOps.push({
                        type: "removeMark",
                        markType: step.mark.type,
                        start: doc.content.getCursorAt(
                            contentPosFromProsemirrorPos(step.from)
                        ),
                        end: doc.content.getCursorAt(
                            contentPosFromProsemirrorPos(step.to)
                        ),
                    })
                })

                break
            }
        }
    })

    return newDoc
}

if (editorNode) {
    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    let state = EditorState.create({
        schema,
        plugins: [keymap(richTextKeymap)],
        doc: prosemirrorDocFromAutomergeDoc(doc),
    })

    // Create a view for the state and generate transactions when the user types.
    const view = new EditorView(editorNode, {
        // state.doc is a read-only data structure using a node hierarchy
        // A node contains a fragment with zero or more child nodes.
        // Text is modeled as a flat sequence of tokens.
        // Each document has a unique valid representation.
        // Order of marks specified by schema.
        state,
        // Intercept transactions.
        dispatchTransaction: (txn: Transaction) => {
            console.log("dispatch", Math.random().toPrecision(3), txn)
            let state = view.state

            // Compute a new automerge doc and selection point
            const newDoc = applyTransaction(doc, txn)
            doc = newDoc // store updated Automerge doc in our global mutable state

            console.log("Table of format ops:")
            console.table(
                doc.formatOps.map(op => ({
                    type: op.type,
                    start: op.start.index,
                    end: op.end.index,
                    markType: op.markType,
                }))
            )

            // Derive a new PM doc from the new Automerge doc
            const newProsemirrorDoc = prosemirrorDocFromAutomergeDoc(doc)

            // Apply a transaction that swaps out the new doc in the editor state
            state = state.apply(
                state.tr.replace(
                    0,
                    state.doc.content.size,
                    new Slice(newProsemirrorDoc.content, 0, 0)
                )
            )

            // Now that we have a new doc, we can compute the new selection.
            // We simply copy over the positions from the selection on the original txn,
            // but resolve them into the new doc.
            // (It doesn't work to just use the selection directly off the txn,
            // because that has pointers into the old stale doc state)
            const newSelection = new TextSelection(
                state.doc.resolve(txn.selection.anchor),
                state.doc.resolve(txn.selection.head)
            )

            // Apply a transaction that sets the new selection
            state = state.apply(state.tr.setSelection(newSelection))

            // Great, now we have our final state! We finish by updating the view.
            view.updateState(state)

            console.log(
                "steps",
                txn.steps.map(s => s.toJSON()),
                "newState",
                state
            )
        },
    })
    window.view = view
}

//
