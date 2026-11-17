// One list from the Lists screen: an editable title, checklist items (tap to check off, hold and drag
// to rearrange, swipe left to delete, swipe right to edit), and headings that group the items under them (e.g. one per
// person on a gift list). Adding is on the right, as on the grocery list (at the top on phones).
import { useRef, useState } from 'react';
import type { Checklist, ListItem, Task } from '../../data/types';
import { useData } from '../../data/store';
import { nextDue } from '../../data/tasks';
import { dayOf } from '../../lib/repeat';
import { useNow } from '../../lib/clock';
import { openTaskSheet } from '../tasks/TaskSheet';
import { whenText } from '../tasks/AllTasks';
import {
  addListItem,
  deleteList,
  editListItem,
  removeListItem,
  renameList,
  reorderListItems,
  restoreList,
  restoreListItem,
  setListEmoji,
  linkedTasks,
  unlinkTasks,
  relinkTasks,
  deleteTask,
  restoreTask,
  toggleListItem,
} from '../../data/actions';
import { closeSheet, openSheet, toast } from '../../app/ui';
import { EmojiPicker } from '../../ui/EmojiPicker';
import { useLayout } from '../../app/layout';
import { Icon } from '../../ui/Icon';
import { PageHeader, SheetHeader } from '../../ui/headers';
import { EmptyNote } from '../../ui/EmptyNote';
import { useHoldReorder } from '../../ui/useHoldReorder';
import type { SwipeSide } from '../../ui/useSwipeReveal';
import { SwipeRow, deleteAction, editAction } from '../../ui/SwipeRow';
import { EditField } from '../../ui/EditField';
import { AddBar } from '../../ui/AddBar';
import css from './ChecklistView.module.css';

export function ChecklistView({ list, onBack }: { list: Checklist; onBack: () => void }) {
  // The add box is beside the list on the frame, above it on phones
  const phone = useLayout() === 'phone';
  const data = useData('taskDone', 'tasks');
  const now = useNow();
  const [text, setText] = useState('');
  /** The row swiped open to show an action, and which side (one row at a time) */
  const [swiped, setSwiped] = useState<{ id: string; side: SwipeSide } | null>(null);
  /** The row whose text is being edited */
  const [editing, setEditing] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { order, ghost, ghostStyle, itemProps } = useHoldReorder({
    ids: list.items.map((i) => i.id),
    onCommit: (ids) => reorderListItems(list.id, ids),
    container: view,
    scroller,
  });
  const byId = new Map(list.items.map((i) => [i.id, i]));
  const lines = list.items.filter((i) => !i.heading);
  const done = lines.filter((i) => i.done).length;

  const add = (heading: boolean) => {
    if (!text.trim()) return;
    addListItem(list.id, text, heading);
    setText('');
    input.current?.focus();
    // keep the newest item in view
    requestAnimationFrame(() =>
      scroller.current?.scrollTo({
        top: scroller.current.scrollHeight,
        behavior: 'smooth',
      }),
    );
  };

  const remove = (i: ListItem) =>
    withReminders(linkedTasks(list.id, i.id), 'item', (undoTasks) => {
      const gone = removeListItem(list.id, i.id);
      if (gone)
        toast(
          <>
            Removed <b>{i.text}</b>
          </>,
          {
            icon: 'trash',
            undo: () => {
              restoreListItem(list.id, gone.item, gone.at);
              undoTasks();
            },
          },
        );
    });

  const removeList = () =>
    withReminders(linkedTasks(list.id), 'list', (undoTasks) => {
      const gone = deleteList(list.id);
      onBack();
      if (gone)
        toast(
          <>
            Deleted <b>{gone.list.title || 'Untitled list'}</b>
          </>,
          {
            icon: 'trash',
            undo: () => {
              restoreList(gone.list, gone.at);
              undoTasks();
            },
          },
        );
    });

  /** An item's reminder (the first, if there are several) and when it's next due */
  const reminderFor = (itemId: string) => {
    const t = data.tasks.find((x) => x.listId === list.id && x.listItemId === itemId);
    if (!t) return null;
    const rows = data.taskDone.filter((x) => x.task === t.id);
    return { task: t, label: whenText(nextDue(t, rows, dayOf(now)), dayOf(now)) };
  };

  return (
    <div className={css.check} ref={view}>
      <PageHeader
        className={css.head}
        onBack={onBack}
        kicker={lines.length ? `${done} of ${lines.length} done` : 'New list'}
        title={
          <span className={css.titleRow}>
            <button
              className={css.emojiBtn}
              aria-label="Change the list’s emoji"
              onClick={() => openEmojiSheet(list.id, list.title)}
            >
              {list.emoji}
            </button>
            <input
              className={css.title}
              value={list.title}
              placeholder="Name this list"
              aria-label="List name"
              autoComplete="off"
              enterKeyHint="done"
              // A brand-new list opens with its name ready to type
              autoFocus={!list.title}
              onChange={(e) => renameList(list.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') input.current?.focus();
              }}
            />
          </span>
        }
      >
        <button className="btn btn--ghost" onClick={removeList}>
          <Icon name="trash" size={20} />
          Delete list
        </button>
      </PageHeader>

      <div className={css.list} ref={scroller} data-dragging={ghost ? '' : undefined} data-scroll-top>
        {list.items.length ? (
          order.map((id) => {
            const i = byId.get(id);
            return i ? (
              <Row
                key={id}
                i={i}
                lifted={ghost?.id === id}
                props={itemProps(id)}
                open={swiped?.id === id ? swiped.side : null}
                onOpenChange={(side) => setSwiped(side ? { id, side } : null)}
                // While a row is open, a tap anywhere in the list just closes it
                onTap={() => (swiped ? setSwiped(null) : !i.heading && toggleListItem(list.id, id))}
                onRemove={() => {
                  setSwiped(null);
                  remove(i);
                }}
                editing={editing === id}
                onEdit={() => {
                  setSwiped(null);
                  setEditing(id);
                }}
                reminder={i.heading ? null : reminderFor(id)}
                onRemind={
                  i.heading
                    ? undefined
                    : () => {
                        setSwiped(null);
                        const r = reminderFor(id);
                        if (r) openTaskSheet(r.task);
                        else openTaskSheet(undefined, { title: i.text, listId: list.id, listItemId: id });
                      }
                }
                onEditDone={(value) => {
                  if (value !== null) editListItem(list.id, id, value);
                  setEditing(null);
                }}
              />
            ) : null;
          })
        ) : (
          <EmptyNote large className={css.empty}>
            Nothing here yet.
            <br />
            <i>Add the first item {phone ? 'above' : 'on the right'}.</i>
          </EmptyNote>
        )}
      </div>
      {ghost && byId.get(ghost.id) && (
        <div className={rowClass(byId.get(ghost.id)!) + ' ' + css.ghost} style={ghostStyle}>
          <div className={slideClass(byId.get(ghost.id)!)}>
            <RowBody i={byId.get(ghost.id)!} />
          </div>
        </div>
      )}

      <aside className={css.side}>
        <div className={css.add + ' surface'}>
          <AddBar value={text} onChange={setText} onSubmit={() => add(false)} inputRef={input} />
          <div className={css.addButtons}>
            <button className="btn btn--solid" disabled={!text.trim()} onClick={() => add(false)}>
              Add item
            </button>
            <button className="btn btn--ghost" disabled={!text.trim()} onClick={() => add(true)}>
              Add as heading
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Row({
  i,
  lifted,
  props,
  open,
  onOpenChange,
  onTap,
  onRemove,
  editing,
  onEdit,
  onEditDone,
  reminder,
  onRemind,
}: {
  i: ListItem;
  lifted: boolean;
  props: ReturnType<ReturnType<typeof useHoldReorder>['itemProps']>;
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  onTap: () => void;
  onRemove: () => void;
  editing: boolean;
  onEdit: () => void;
  /** The new text, or null if editing was cancelled */
  onEditDone: (value: string | null) => void;
  /** Its reminder on the Tasks screen, if it has one */
  reminder: { label: string } | null;
  /** Add (or edit) a reminder: items only, not headings */
  onRemind?: () => void;
}) {
  return (
    <SwipeRow
      open={open}
      onOpenChange={onOpenChange}
      onTap={editing ? undefined : onTap}
      disabled={lifted || editing}
      className={rowClass(i) + (lifted ? ' ' + css.isLifted : '')}
      slideClass={slideClass(i)}
      rowProps={props}
      // Items have Edit and Remind behind their start, Delete behind their end
      start={[
        editAction(i.text, onEdit),
        ...(onRemind
          ? [
              {
                icon: 'bell',
                tone: 'remind',
                label: (reminder ? 'Edit reminder for ' : 'Remind me: ') + i.text,
                run: onRemind,
              } as const,
            ]
          : []),
      ]}
      end={[deleteAction(i.text, onRemove)]}
    >
      <RowBody i={i} editing={editing} onEditDone={onEditDone} reminder={reminder} />
    </SwipeRow>
  );
}

/** A row's classes (shared with the copy drawn under the finger while dragging, so it looks the same) */
const rowClass = (i: ListItem) => css.row + (i.heading ? ' ' + css.heading : '') + (i.done ? ' ' + css.isDone : '');
/** Items are cards (`surface`: Glass's frosted edge); headings sit flat on the page with their underline */
const slideClass = (i: ListItem) => css.slide + (i.heading ? '' : ' surface');

/** What a row shows (also drawn under the finger while dragging); while editing, its text is a field */
function RowBody({
  i,
  editing,
  onEditDone,
  reminder,
}: {
  i: ListItem;
  editing?: boolean;
  onEditDone?: (value: string | null) => void;
  reminder?: { label: string } | null;
}) {
  const textClass = i.heading ? css.headingText + ' serif' : css.text;
  const text =
    editing && onEditDone ? (
      <EditField className={textClass + ' ' + css.editField} value={i.text} onDone={onEditDone} />
    ) : (
      <span className={textClass}>{i.text}</span>
    );
  if (i.heading) return text;
  return (
    <>
      <span className={css.box}>
        <Icon name="check" size={22} />
      </span>
      {text}
      {reminder && !editing && (
        <span className={css.reminder}>
          <Icon name="bell" size={15} />
          {reminder.label}
        </span>
      )}
    </>
  );
}

/** Pick a list's emoji (shown on its card and beside its name) */
function openEmojiSheet(listId: string, title: string) {
  openSheet(
    () => (
      <div className="sheet-pad">
        <SheetHeader kicker={title || 'Untitled list'} title="Pick an emoji" />
        <EmojiPicker
          onPick={(e) => {
            setListEmoji(listId, e);
            closeSheet();
          }}
        />
      </div>
    ),
    { cls: 'sheet--wide' },
  );
}

/**
 * Deleting a list (or item) that has reminders on the Tasks screen: ask whether those go too, or stay
 * as plain tasks. `run` does the delete; it gets an undo for whatever happened to the reminders.
 * With no reminders it just runs.
 */
function withReminders(tasks: Task[], what: 'list' | 'item', run: (undoTasks: () => void) => void) {
  if (!tasks.length) return run(() => {});
  const n = tasks.length;
  const them = n === 1 ? 'it' : 'them';
  openSheet(() => (
    <div className="sheet-pad">
      <SheetHeader
        kicker={what === 'list' ? 'Delete list' : 'Delete item'}
        title={n === 1 ? 'Delete its reminder too?' : `Delete its ${n} reminders too?`}
      />
      <p className="sheet-p">
        This {what} has {n === 1 ? 'a reminder' : `${n} reminders`} on the Tasks screen
        {n === 1 ? ` (“${tasks[0].title}”)` : ''}. You can delete {them} too, or keep {them} as{' '}
        {n === 1 ? 'a task' : 'tasks'}.
      </p>
      <div className="sheet-actions">
        <button className="btn btn--ghost" onClick={closeSheet}>
          Cancel
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => {
            closeSheet();
            unlinkTasks(tasks);
            run(() => relinkTasks(tasks));
          }}
        >
          Keep as {n === 1 ? 'a task' : 'tasks'}
        </button>
        <button
          className="btn btn--danger"
          onClick={() => {
            closeSheet();
            const gone = tasks.map((t) => deleteTask(t.id));
            run(() => gone.forEach((g) => g && restoreTask(g.task, g.done)));
          }}
        >
          Delete {n === 1 ? 'reminder' : 'reminders'}
        </button>
      </div>
    </div>
  ));
}
