import type { Group, Message, Program } from '../../types'
import {
  ERRORS_GROUP,
  arg,
  body,
  fellBack,
  inherited,
  markup,
  message,
  plural,
  pound,
  program,
  text,
  translated,
  workedMessages,
} from './program'

// The worked example plus the shapes any real catalog reaches: two sibling
// plurals, a nested plural, a markup arm that dropped its tag, a tag inside a
// plural branch, a handler argument the source body uses bare, a group holding
// markup members, and a source string with `*/`.
export function acceptanceProgram(): Program {
  return program({
    messages: [...workedMessages(), ...extraMessages()],
    groups: [ERRORS_GROUP, TERMS_GROUP],
  })
}

export const TERMS_GROUP: Group = {
  name: 'terms',
  id: 'terms',
  typeBase: 'Terms',
  prefix: 'terms',
  members: [
    { key: 'terms.accept', id: 'terms_accept', member: 'accept' },
    { key: 'terms.bare', id: 'terms_bare', member: 'bare' },
    { key: 'terms.dropped', id: 'terms_dropped', member: 'dropped' },
    { key: 'terms.notice', id: 'terms_notice', member: 'notice' },
    { key: 'terms.title', id: 'terms_title', member: 'title' },
  ],
}

export function extraMessages(): readonly Message[] {
  return [
    message({
      key: 'cart.counts',
      source:
        '{files, plural, one {# file} other {# files}} in {folders, plural, one {# folder} other {# folders}}',
      args: [
        { name: 'files', type: { kind: 'number' } },
        { name: 'folders', type: { kind: 'number' } },
      ],
      bodies: [
        body('en', [
          plural('files', {
            branches: [
              { keyword: 'one', body: [pound(), text(' file')] },
              { keyword: 'other', body: [pound(), text(' files')] },
            ],
          }),
          text(' in '),
          plural('folders', {
            branches: [
              { keyword: 'one', body: [pound(), text(' folder')] },
              { keyword: 'other', body: [pound(), text(' folders')] },
            ],
          }),
        ]),
        body('de', [
          plural('files', {
            branches: [
              { keyword: 'one', body: [pound(), text(' Datei')] },
              { keyword: 'other', body: [pound(), text(' Dateien')] },
            ],
          }),
          text(' in '),
          plural('folders', {
            branches: [
              { keyword: 'one', body: [pound(), text(' Ordner')] },
              { keyword: 'other', body: [pound(), text(' Ordnern')] },
            ],
          }),
        ]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'cart.nested',
      source:
        '{users, plural, offset:2 =0 {nobody} one {{files, plural, one {one user, one file} other {# files for one user}}} other {# users, {files, plural, one {one file} other {# files}}}}',
      args: [
        { name: 'users', type: { kind: 'number' } },
        { name: 'files', type: { kind: 'number' } },
      ],
      bodies: [
        body('en', [
          plural('users', {
            offset: 2,
            exact: [{ value: 0, body: [text('nobody')] }],
            branches: [
              {
                keyword: 'one',
                body: [
                  plural('files', {
                    branches: [
                      { keyword: 'one', body: [text('one user, one file')] },
                      { keyword: 'other', body: [pound(), text(' files for one user')] },
                    ],
                  }),
                ],
              },
              {
                keyword: 'other',
                body: [
                  pound(),
                  text(' users, '),
                  plural('files', {
                    branches: [
                      { keyword: 'one', body: [text('one file')] },
                      { keyword: 'other', body: [pound(), text(' files')] },
                    ],
                  }),
                ],
              },
            ],
          }),
        ]),
      ],
      origins: [translated('en'), fellBack('de', 'en', 'missing'), fellBack('de-AT', 'en', 'missing')],
    }),
    message({
      key: 'terms.bare',
      source: 'Click {link} now',
      args: [{ name: 'link', type: { kind: 'markup' } }],
      bodies: [
        body('en', [text('Click '), arg('link'), text(' now')]),
        body('de', [text('Klick '), markup('link', [text('hier')]), text(' jetzt')]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'terms.dropped',
      source: 'Please <notice>read this</notice> now.',
      kind: 'markup',
      args: [{ name: 'notice', type: { kind: 'markup' } }],
      bodies: [
        body('en', [text('Please '), markup('notice', [text('read this')]), text(' now.')]),
        body('de', [text('Bitte lies das jetzt.')]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'terms.notice',
      source: 'You have {count, plural, one {<b>one file</b>} other {<b># files</b>}} to read',
      kind: 'markup',
      args: [
        { name: 'count', type: { kind: 'number' } },
        { name: 'b', type: { kind: 'markup' } },
      ],
      bodies: [
        body('en', [
          text('You have '),
          plural('count', {
            branches: [
              { keyword: 'one', body: [markup('b', [text('one file')])] },
              { keyword: 'other', body: [markup('b', [pound(), text(' files')])] },
            ],
          }),
          text(' to read'),
        ]),
        body('de', [
          text('Du hast '),
          plural('count', {
            branches: [
              { keyword: 'one', body: [markup('b', [text('eine Datei')])] },
              { keyword: 'other', body: [markup('b', [pound(), text(' Dateien')])] },
            ],
          }),
          text(' zu lesen'),
        ]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'terms.title',
      source: 'Terms of service',
      bodies: [
        body('en', [text('Terms of service')]),
        body('de', [text('Nutzungsbedingungen')]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'dev.snippet',
      source: 'Matches /x*/ in a comment',
      bodies: [
        body('en', [text('Matches /x*/ in a comment')]),
        body('de', [text('Passt auf /x*/ in einem Kommentar')]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
  ]
}
