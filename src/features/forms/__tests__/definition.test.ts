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
  hasStaffOnlyField,
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

// -- The capabilities a staff-completed field workflow needs -----------------------
//
// Each of these mirrors a rule app.forms_validate_definition /
// app.forms_validate_answers enforces in the database. The database is the
// authority; these assert that the builder, the preview and SimpleBot agree with
// it, so a form cannot look valid here and be refused there.

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

/** The shape of the PCH installer form: outcome first, then what applies. */
const visit: FormDefinition = {
  fields: [
    {
      id: 'property',
      type: 'entity',
      entity: 'programme_property',
      label: 'Property',
      required: true
    },
    {
      id: 'outcome',
      type: 'single_choice',
      label: 'What happened?',
      required: true,
      options: [
        { id: 'not_home', label: 'Tenant not home' },
        { id: 'sim_ok', label: 'SIM changed - portal working' },
        { id: 'sim_bad', label: 'SIM changed - portal not working' },
        { id: 'dead', label: 'Meter dead' }
      ]
    },
    {
      id: 'calling_card',
      type: 'photo',
      label: 'Calling card photo',
      required: true,
      max: 2,
      condition: { field: 'outcome', op: 'equals', value: 'not_home' }
    },
    {
      id: 'sim_serial',
      type: 'short_text',
      label: 'SIM serial',
      required: true,
      condition: { field: 'outcome', op: 'in', values: ['sim_ok', 'sim_bad'] }
    },
    {
      id: 'csq',
      type: 'number',
      label: 'CSQ',
      required: true,
      min: 0,
      max: 31,
      condition: { field: 'outcome', op: 'in', values: ['sim_ok', 'sim_bad'] }
    }
  ]
};

describe('photo questions', () => {
  it('accepts a list of evidence ids within the limit', () => {
    const { errors, clean } = checkAnswers(visit, {
      property: UUID_A,
      outcome: 'not_home',
      calling_card: [UUID_B]
    });
    expect(errors).toEqual({});
    expect(clean.calling_card).toEqual([UUID_B]);
  });

  it('refuses something that is not an evidence id', () => {
    const { errors } = checkAnswers(visit, {
      property: UUID_A,
      outcome: 'not_home',
      calling_card: ['not-an-id']
    });
    expect(errors.calling_card).toBeTruthy();
  });

  it('refuses more files than the question allows, and the same file twice', () => {
    const tooMany = checkAnswers(visit, {
      property: UUID_A,
      outcome: 'not_home',
      calling_card: [UUID_A, UUID_B, '33333333-3333-4333-8333-333333333333']
    });
    expect(tooMany.errors.calling_card).toMatch(/at most 2/);
    const twice = checkAnswers(visit, {
      property: UUID_A,
      outcome: 'not_home',
      calling_card: [UUID_A, UUID_A]
    });
    expect(twice.errors.calling_card).toMatch(/twice/);
  });

  it('is required when it is required and visible', () => {
    const { errors } = checkAnswers(visit, {
      property: UUID_A,
      outcome: 'not_home'
    });
    expect(errors.calling_card).toBeTruthy();
  });

  it('has a maximum but no minimum', () => {
    expect(
      definitionProblem({
        fields: [{ id: 'p', type: 'photo', label: 'P', min: 1, max: 2 }]
      })?.problem
    ).toMatch(/maximum only/);
    expect(
      definitionProblem({
        fields: [{ id: 'p', type: 'photo', label: 'P', max: 99 }]
      })?.problem
    ).toMatch(/1-10 files/);
    expect(
      definitionProblem({
        fields: [{ id: 'p', type: 'photo', label: 'P', max: 3 }]
      })
    ).toBeNull();
  });

  it('gets a sensible default, and loses its limit when the type changes', () => {
    const made = defaultField('photo', 'Meter photo', EMPTY_DEFINITION);
    expect(made.max).toBe(4);
    const changed = updateField(addField(EMPTY_DEFINITION, made), made.id, {
      type: 'short_text'
    });
    expect(changed.fields[0].max).toBeUndefined();
  });
});

describe('entity (lookup) questions', () => {
  it('accepts one id and refuses anything else', () => {
    expect(
      checkAnswers(visit, {
        property: UUID_A,
        outcome: 'not_home',
        calling_card: [UUID_B]
      }).errors.property
    ).toBeUndefined();
    expect(
      checkAnswers(visit, { property: 'nope', outcome: 'dead' }).errors.property
    ).toBeTruthy();
  });

  it('must name what it looks up, and only a lookup may', () => {
    expect(
      definitionProblem({
        fields: [{ id: 'p', type: 'entity', label: 'P' }]
      })?.problem
    ).toMatch(/what this question looks up/);
    expect(
      definitionProblem({
        fields: [
          {
            id: 'p',
            type: 'short_text',
            label: 'P',
            entity: 'programme_property'
          }
        ]
      })?.problem
    ).toMatch(/Only a lookup/);
  });

  it('gets a kind by default, and loses it when the type changes', () => {
    const made = defaultField('entity', 'Property', EMPTY_DEFINITION);
    expect(made.entity).toBe('programme_property');
    const changed = updateField(addField(EMPTY_DEFINITION, made), made.id, {
      type: 'short_text'
    });
    expect(changed.fields[0].entity).toBeUndefined();
  });
});

describe('the "in" condition', () => {
  it('shows a field for any of its values and hides it for the others', () => {
    const shown = (outcome: string) =>
      visibleFieldIds(visit, { property: UUID_A, outcome });
    expect(shown('sim_ok').has('sim_serial')).toBe(true);
    expect(shown('sim_bad').has('sim_serial')).toBe(true);
    expect(shown('not_home').has('sim_serial')).toBe(false);
    expect(shown('dead').has('sim_serial')).toBe(false);
    // ...and the follow-ups that do not apply are not required either.
    expect(
      checkAnswers(visit, { property: UUID_A, outcome: 'dead' }).errors
    ).toEqual({});
  });

  it('makes its fields required only when they are shown', () => {
    const { errors } = checkAnswers(visit, {
      property: UUID_A,
      outcome: 'sim_ok'
    });
    expect(errors.sim_serial).toBeTruthy();
    expect(errors.csq).toBeTruthy();
    expect(errors.calling_card).toBeUndefined();
  });

  it('needs values, not a value', () => {
    const bad = definitionProblem({
      fields: [
        {
          id: 'a',
          type: 'yes_no',
          label: 'A'
        },
        {
          id: 'b',
          type: 'short_text',
          label: 'B',
          condition: { field: 'a', op: 'in', value: true }
        }
      ]
    });
    expect(bad?.problem).toMatch(/takes a list/);
  });

  it('refuses an option that does not exist, and a repeated value', () => {
    const withCondition = (values: string[]) =>
      definitionProblem({
        fields: [
          visit.fields[1],
          {
            id: 'b',
            type: 'short_text',
            label: 'B',
            condition: { field: 'outcome', op: 'in', values }
          }
        ]
      });
    expect(withCondition(['made_up'])?.problem).toMatch(/does not exist/);
    expect(withCondition(['sim_ok', 'sim_ok'])?.problem).toMatch(/repeated/);
    expect(withCondition(['sim_ok', 'sim_bad'])).toBeNull();
  });

  it('does not apply to multiple choice, which has "includes"', () => {
    const bad = definitionProblem({
      fields: [
        {
          id: 'a',
          type: 'multiple_choice',
          label: 'A',
          options: [{ id: 'x', label: 'X' }]
        },
        {
          id: 'b',
          type: 'short_text',
          label: 'B',
          condition: { field: 'a', op: 'in', values: ['x'] }
        }
      ]
    });
    expect(bad?.problem).toMatch(/does not apply to multiple choice/);
  });

  it('survives an operator change in the builder', () => {
    const applied = applyOperations(
      {
        title: 'T',
        description: null,
        definition: { fields: [visit.fields[0], visit.fields[1]] }
      },
      [
        {
          op: 'add_field',
          field: {
            type: 'short_text',
            label: 'Why',
            condition: { field: 'outcome', op: 'in', values: ['sim_ok'] }
          }
        }
      ]
    );
    expect(applied.ok).toBe(true);
  });
});

describe('the whole visit definition', () => {
  it('is valid', () => {
    expect(definitionProblem(visit)).toBeNull();
  });

  it('is recognised as needing a signed-in person', () => {
    expect(hasStaffOnlyField(visit)).toBe(true);
    expect(hasStaffOnlyField(feedback)).toBe(false);
  });
});
