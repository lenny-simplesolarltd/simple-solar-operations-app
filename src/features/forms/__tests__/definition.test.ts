import { describe, expect, it } from 'vitest';
import {
  addField,
  applyOperations,
  checkAnswers,
  defaultField,
  definitionProblem,
  duplicateField,
  EMPTY_DEFINITION,
  finaliseIds,
  moveField,
  newFieldId,
  removeField,
  updateField,
  visibleFieldIds,
  type FormDefinition
} from '../definition';

const feedback: FormDefinition = {
  fields: [
    {
      id: 'rating',
      type: 'scale',
      label: 'Rating',
      required: true,
      min: 1,
      max: 10
    },
    {
      id: 'tidy',
      type: 'yes_no',
      label: 'Was the installer tidy?',
      required: true
    },
    {
      id: 'mess',
      type: 'long_text',
      label: 'What was left untidy?',
      required: true,
      condition: { field: 'tidy', op: 'equals', value: false }
    },
    { id: 'comments', type: 'long_text', label: 'Comments' }
  ]
};

describe('definition rules (mirror the database)', () => {
  it('accepts a valid form', () => {
    expect(definitionProblem(feedback)).toBeNull();
  });

  it.each([
    [
      'duplicate ids',
      {
        fields: [
          { id: 'a', type: 'short_text', label: 'A' },
          { id: 'a', type: 'short_text', label: 'B' }
        ]
      }
    ],
    [
      'unknown keys (no scripts)',
      { fields: [{ id: 'a', type: 'short_text', label: 'A', onchange: 'x' }] }
    ],
    [
      'choices without options',
      { fields: [{ id: 'c', type: 'dropdown', label: 'C' }] }
    ],
    [
      'a bad scale',
      { fields: [{ id: 's', type: 'scale', label: 'S', min: 1, max: 50 }] }
    ],
    [
      'a condition on a later question',
      {
        fields: [
          {
            id: 'b',
            type: 'short_text',
            label: 'B',
            condition: { field: 'a', op: 'answered' }
          },
          { id: 'a', type: 'short_text', label: 'A' }
        ]
      }
    ],
    [
      'a required heading',
      { fields: [{ id: 'h', type: 'section', label: 'H', required: true }] }
    ]
  ])('refuses %s', (_, definition) => {
    expect(definitionProblem(definition as FormDefinition)).not.toBeNull();
  });
});

describe('editing operations', () => {
  it('adds with unique readable ids', () => {
    let d = addField(
      EMPTY_DEFINITION,
      defaultField('short_text', 'Your name', EMPTY_DEFINITION)
    );
    d = addField(d, defaultField('short_text', 'Your name', d));
    expect(d.fields.map((f) => f.id)).toEqual(['your_name', 'your_name_2']);
    expect(newFieldId('123 !!', d)).toBe('question');
  });

  it('removing a question removes conditions that depended on it', () => {
    const d = removeField(feedback, 'tidy');
    expect(d.fields.find((f) => f.id === 'mess')?.condition).toBeUndefined();
  });

  it('moving a question above its condition source drops that condition, keeping the form valid', () => {
    const d = moveField(feedback, 'mess', 0);
    expect(d.fields[0].id).toBe('mess');
    expect(d.fields[0].condition).toBeUndefined();
    expect(definitionProblem(d)).toBeNull();
  });

  it('changing type keeps only the settings that fit it', () => {
    const d = updateField(feedback, 'rating', { type: 'short_text' });
    const f = d.fields[0];
    expect(f.min).toBeUndefined();
    expect(f.max).toBeUndefined();
    const choice = updateField(feedback, 'comments', { type: 'single_choice' });
    expect(choice.fields[3].options?.length).toBe(2);
  });

  it('duplicates without copying the condition', () => {
    const d = duplicateField(feedback, 'mess');
    expect(d.fields[3].id).toBe('what_was_left_untidy');
    expect(d.fields[3].condition).toBeUndefined();
  });

  it('applies SimpleBot-style operations and reports unknown ids instead of guessing', () => {
    const result = applyOperations(
      { title: 'Feedback', description: null, definition: feedback },
      [
        {
          op: 'add_field',
          field: {
            type: 'yes_no',
            label: 'Would you recommend us?',
            required: true
          }
        },
        {
          op: 'update_field',
          field_id: 'comments',
          changes: { required: false, label: 'Any comments?' }
        },
        { op: 'move_field', field_id: 'comments', position: 5 },
        { op: 'set_title', title: 'Post-install feedback' }
      ]
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.title).toBe('Post-install feedback');
      expect(result.state.definition.fields.map((f) => f.id)).toEqual([
        'rating',
        'tidy',
        'mess',
        'would_you_recommend_us',
        'comments'
      ]);
    }
    const bad = applyOperations(
      { title: 'x', description: null, definition: feedback },
      [{ op: 'remove_field', field_id: 'question_3' }]
    );
    expect(bad).toEqual({
      ok: false,
      problem: 'There is no question with id "question_3".'
    });
  });
});

describe('answers (mirror the database)', () => {
  it('shows a conditional question only when its condition holds', () => {
    expect(visibleFieldIds(feedback, { tidy: true }).has('mess')).toBe(false);
    expect(visibleFieldIds(feedback, { tidy: false }).has('mess')).toBe(true);
  });

  it('requires visible required questions, and drops hidden answers', () => {
    expect(checkAnswers(feedback, { rating: 7 }).errors).toMatchObject({
      tidy: expect.any(String)
    });
    expect(
      checkAnswers(feedback, { rating: 7, tidy: false }).errors
    ).toMatchObject({ mess: expect.any(String) });
    const ok = checkAnswers(feedback, {
      rating: 7,
      tidy: true,
      mess: 'stale',
      comments: ' Great '
    });
    expect(ok.errors).toEqual({});
    expect(ok.clean).toEqual({ rating: 7, tidy: true, comments: 'Great' });
  });

  it('checks ranges and types', () => {
    expect(
      checkAnswers(feedback, { rating: 11, tidy: true }).errors.rating
    ).toBeTruthy();
    expect(
      checkAnswers(feedback, { rating: 7.5, tidy: true }).errors.rating
    ).toBeTruthy();
  });
});

describe('readable ids on save', () => {
  it('renames placeholder ids from their labels and keeps conditions pointing at them', () => {
    const d: FormDefinition = {
      fields: [
        { id: 'new_question', type: 'yes_no', label: 'Do you have a battery?' },
        {
          id: 'new_question_2',
          type: 'number',
          label: 'How many batteries?',
          condition: { field: 'new_question', op: 'equals', value: true }
        },
        { id: 'new_question_3', type: 'short_text', label: 'New question' }
      ]
    };
    const out = finaliseIds(d);
    expect(out.fields.map((f) => f.id)).toEqual([
      'do_you_have_a_battery',
      'how_many_batteries',
      'new_question_3'
    ]);
    expect(out.fields[1].condition?.field).toBe('do_you_have_a_battery');
    expect(definitionProblem(out)).toBeNull();
  });
});
