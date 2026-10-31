import type { NextRequest } from 'next/server';
import { hashToken, hub } from '@/server/hub';
import { isTeacher } from '@/server/auth';
import { addTopic, copyTopic, editTopic, orderTopics } from '@/server/agora';

const TEACHER_ACTIONS = new Set([
  'approve', 'reject', 'approve-all', 'revoke', 'roster', 'remove-student', 'create-event', 'delete-event', 'reward', 'retry-round', 'open-lobby', 'close-session', 'control',
  'add-class', 'rename-class', 'delete-class', 'revoke-class', 'remove-students',
  'agora-add', 'agora-edit', 'agora-delete', 'agora-order', 'agora-copy', 'agora-show', 'agora-close', 'agora-down', 'agora-time',
  'agora-reveal', 'agora-layout', 'agora-page', 'agora-pages', 'agora-music', 'agora-card', 'agora-card-delete',
]);

export async function POST(request: NextRequest) {
  // A JSON content type forces a CORS preflight, which this server never approves.
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 16_000) {
    return Response.json({ ok: false, error: '요청이 너무 커요.' }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    // Counted while reading, so a chunked body without Content-Length can't be huge either.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_000) {
          await reader.cancel().catch(() => undefined);
          return Response.json({ ok: false, error: '요청이 너무 커요.' }, { status: 413 });
        }
        chunks.push(value);
      }
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad body');
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 400 });
  }
  const type = String(body.type ?? '');
  const h = hub();
  try {
    if (TEACHER_ACTIONS.has(type)) {
      if (!isTeacher(request)) return Response.json({ ok: false, error: '노트북의 선생님 화면에서만 할 수 있어요.' }, { status: 403 });
      switch (type) {
        case 'approve':
          if (body.kind !== 'match' && body.kind !== 'replace' && body.kind !== 'new' && body.kind !== 'conflict') throw new Error('선생님 화면을 새로 고친 뒤 다시 승인해 주세요.');
          h.decideRequest(String(body.requestId), true, body.kind);
          break;
        case 'reject':
          h.decideRequest(String(body.requestId), false);
          break;
        case 'approve-all':
          return Response.json({ ok: true, approved: h.approveAllSimple() });
        case 'revoke':
          h.revokeDevice(String(body.studentId));
          break;
        case 'roster':
          return Response.json({ ok: true, added: h.setRoster(String(body.classId), String(body.text ?? '')) });
        case 'add-class':
          return Response.json({ ok: true, classId: h.addClass(String(body.name ?? '')) });
        case 'rename-class':
          h.renameClass(String(body.classId), String(body.name ?? ''));
          break;
        case 'delete-class':
          h.deleteClass(String(body.classId), body.withStudents === true);
          break;
        case 'revoke-class':
          return Response.json({ ok: true, revoked: h.revokeClass(String(body.classId)) });
        case 'remove-student':
          h.removeStudent(String(body.studentId));
          break;
        case 'remove-students':
          return Response.json({ ok: true, removed: h.removeStudents(Array.isArray(body.studentIds) ? body.studentIds.slice(0, 500).map(String) : []) });
        case 'create-event':
          return Response.json({ ok: true, eventIds: h.createEvents(String(body.draftId)) });
        case 'delete-event':
          h.deleteEvent(String(body.eventId));
          break;
        case 'reward':
          h.setReward(String(body.eventId), String(body.itemId), Number(body.challengePct), Number(body.growthPp));
          break;
        case 'retry-round':
          h.setRetryRound(String(body.eventId), body.on === true);
          break;
        case 'open-lobby':
          h.openLobby(String(body.eventId), String(body.classId));
          break;
        case 'close-session':
          h.closeSession();
          break;
        case 'control':
          h.control(String(body.action));
          break;
        case 'agora-add':
          return Response.json({ ok: true, topicId: h.changeAgora(() => addTopic(String(body.classId), body)) });
        case 'agora-edit':
          h.changeAgora(() => editTopic(String(body.topicId), body));
          break;
        case 'agora-delete':
          h.removeTopic(String(body.topicId));
          break;
        case 'agora-order':
          h.changeAgora(() => orderTopics(String(body.classId), Array.isArray(body.topicIds) ? body.topicIds.slice(0, 500).map(String) : []));
          break;
        case 'agora-copy':
          return Response.json({ ok: true, copied: h.changeAgora(() => copyTopic(String(body.topicId), Array.isArray(body.classIds) ? body.classIds.slice(0, 100).map(String) : [])) });
        case 'agora-show':
          h.showTopic(String(body.topicId));
          break;
        case 'agora-close':
          h.closeTopic();
          break;
        case 'agora-down':
          h.takeDownTopic();
          break;
        case 'agora-time':
          h.adjustTopicTime(Number(body.minutes));
          break;
        case 'agora-reveal':
          h.revealTopic(String(body.topicId), body.public === true);
          break;
        case 'agora-layout':
          h.layoutTopic(String(body.topicId), { columns: body.columns, sort: body.sort });
          break;
        case 'agora-page':
          h.turnPage(Number(body.dir));
          break;
        // From the projector window, which holds the teacher cookie too.
        case 'agora-pages':
          h.setTopicPages(Number(body.count));
          break;
        case 'agora-music':
          h.toggleTopicMusic();
          break;
        case 'agora-card':
          h.flipTopicCard(String(body.topicId), { studentId: body.studentId === undefined ? undefined : String(body.studentId), number: body.number === undefined ? undefined : Number(body.number) });
          break;
        case 'agora-card-delete':
          h.removeTopicCard(String(body.topicId), String(body.studentId));
          break;
      }
      return Response.json({ ok: true });
    }

    const token = String(body.token ?? '');
    if (token.length < 32) return Response.json({ ok: false, error: '기기 정보가 없어요.' }, { status: 400 });
    const tokenHash = hashToken(token);
    switch (type) {
      case 'hb':
        h.beat(tokenHash, String(body.s ?? '').slice(0, 16));
        break;
      case 'register':
        h.requestRegistration(tokenHash, { classId: String(body.classId ?? ''), number: Number(body.number), name: String(body.name ?? '') });
        break;
      case 'cancel-register':
        h.cancelRegistration(tokenHash);
        break;
      case 'look':
        h.setLook(tokenHash, (body.look ?? {}) as Record<string, string>);
        break;
      case 'pos':
        h.move(tokenHash, Number(body.seq), { x: Number(body.x), y: Number(body.y) }, Number(body.n ?? NaN));
        break;
      case 'text':
        h.submitText(tokenHash, Number(body.seq), String(body.value ?? ''), body.final === true, Number(body.n ?? NaN));
        break;
      case 'practice':
        h.recordPractice(tokenHash, String(body.questionId), Number(body.choice));
        break;
      case 'agora-answer':
        h.answerTopic(tokenHash, String(body.topicId ?? ''), body.text);
        break;
      case 'agora-unanswer':
        h.unanswerTopic(tokenHash, String(body.topicId ?? ''));
        break;
      default:
        return Response.json({ ok: false, error: '알 수 없는 요청이에요.' }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : '문제가 생겼어요.' }, { status: 400 });
  }
}
