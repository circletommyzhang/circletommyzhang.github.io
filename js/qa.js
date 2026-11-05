(function () {
  'use strict';
  const root = document.querySelector('[data-hrqa]');
  if (!root) return;
  const mode = root.dataset.hrqa;
  const cfg = window.HRQA_CONFIG;
  const client = cfg && window.supabase ? window.supabase.createClient(cfg.url, cfg.key, {
    auth: { storageKey: mode === 'admin' ? 'hrqa-admin-session' : 'hrqa-visitor-session', detectSessionInUrl: false }
  }) : null;
  const $ = (selector, within = root) => within.querySelector(selector);
  function node(tag, cls, value) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (value !== undefined && value !== null) n.textContent = String(value);
    return n;
  }
  function date(value) {
    return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function message(target, text, error = false) {
    target.replaceChildren(node('p', 'qa-feedback', text));
    target.firstChild.dataset.error = String(error);
  }
  function errorText(error) {
    const text = error && error.message || '';
    if (/anonymous.*disabled/i.test(text)) return '匿名提交尚未开启，请稍后再试。';
    if (/Failed to fetch|fetch failed|NetworkError|Load failed/i.test(text)) return '暂时连接不上，请稍后重试。';
    if (/PGRST202|schema cache|Could not find the function/i.test(text)) return '问答功能正在配置，请稍后再来。';
    if (/Invalid login credentials/i.test(text)) return '邮箱或密码不正确。';
    if (/rate.limit|too many/i.test(text)) return '提交较频繁，请稍后再试。';
    return /[\u4e00-\u9fff]/.test(text) ? text : '操作未完成，请稍后重试。';
  }
  async function rpc(name, args) {
    if (!client) throw new Error('问答功能正在加载，请刷新页面。');
    const { data, error } = await client.rpc('hrqa_' + name, args || {});
    if (error) throw error;
    return data;
  }
  let visitorPromise = null;
  async function visitor() {
    if (visitorPromise) return visitorPromise;
    visitorPromise = establishVisitor();
    try { return await visitorPromise; } finally { visitorPromise = null; }
  }
  async function establishVisitor() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const result = await client.auth.signInAnonymously();
      if (result.error) throw result.error;
    }
    return await rpc('visitor_name');
  }
  function meta(nicknameValue, created, owner) {
    const m = node('div', 'qa-meta');
    m.append(node('span', 'qa-name', nicknameValue), node('span', '', date(created)));
    if (owner) m.append(node('span', 'qa-badge', '站长'));
    return m;
  }
  function button(text, handler, cls) {
    const b = node('button', cls || '', text); b.type = 'button';
    b.addEventListener('click', handler); return b;
  }
  function markdownTools(textarea) {
    const tools = node('div', 'qa-editor-tools'); tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', '文字格式');
    function format(level) {
      const start = textarea.selectionStart, end = textarea.selectionEnd, value = textarea.value, scroll = textarea.scrollTop;
      if (!level) {
        const selected = value.slice(start, end) || '加粗文字';
        if (value.length - (end - start) + selected.length + 4 > textarea.maxLength) return;
        textarea.setRangeText('**' + selected + '**', start, end, 'select'); textarea.setSelectionRange(start + 2, start + 2 + selected.length);
      } else {
        const a = value.lastIndexOf('\n', start - 1) + 1, nextBreak = value.indexOf('\n', end), b = nextBreak < 0 ? value.length : nextBreak;
        const selected = value.slice(a, b).split('\n').map(line => '#'.repeat(level) + ' ' + line.replace(/^#{1,3}\s+/, '')).join('\n');
        if (value.length - (b - a) + selected.length > textarea.maxLength) return;
        textarea.setRangeText(selected, a, b, 'end');
      }
      textarea.focus({ preventScroll: true }); textarea.scrollTop = scroll; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    [1, 2, 3].forEach(level => { const b = button('H' + level, () => format(level), 'qa-format-button'); b.title = level + ' 级标题'; b.setAttribute('aria-label', level + '级标题'); tools.append(b); });
    const bold = button('B', () => format(0), 'qa-format-button qa-format-bold'); bold.title = '加粗'; bold.setAttribute('aria-label', '加粗'); tools.append(bold);
    const composer = textarea.closest('.qa-composer');
    if (composer) $('.qa-composer-toolbar', composer).prepend(tools); else textarea.parentNode.insertBefore(tools, textarea);
  }
  function markdownBody(value, cls) {
    const body = node('div', cls);
    function inline(target, text) {
      const re = /\*\*([^\n]+?)\*\*/g; let cursor = 0, match;
      while ((match = re.exec(text))) { target.append(document.createTextNode(text.slice(cursor, match.index)), node('strong', '', match[1])); cursor = re.lastIndex; }
      target.append(document.createTextNode(text.slice(cursor)));
    }
    let lines = [];
    function flush() { if (lines.length) { const p = node('p'); inline(p, lines.join('\n')); body.append(p); lines = []; } }
    String(value).split('\n').forEach(line => {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) { flush(); const h = node('h' + heading[1].length); inline(h, heading[2]); body.append(h); }
      else if (!line.trim()) flush(); else lines.push(line);
    }); flush(); return body;
  }
  async function busy(form, action) {
    const controls = Array.from(form.querySelectorAll('button,input,textarea,select'));
    controls.forEach(c => { c.disabled = true; });
    try { return await action(); } finally { controls.forEach(c => { c.disabled = false; }); }
  }
  function commentForm(container, context, list, reload) {
    const section = node('section', 'qa-section');
    const isAnswer = !!context.id && !context.path;
    section.append(node('h2', '', isAnswer ? '参与回答' : '留下评论'));
    const form = node('form', 'qa-form'); form.method = 'post';
    const bodyWrap = node('div');
    const bodyId = context.formId || 'qa-comment-body';
    const bodyLabel = node('label', '', isAnswer ? '你的回答' : '评论内容'); bodyLabel.htmlFor = bodyId;
    const body = node('textarea'); body.id = bodyId; body.required = true; body.maxLength = 6000; body.rows = 5;
    bodyWrap.append(bodyLabel, body);
    const replyContext = node('div', 'qa-reply-context'); replyContext.hidden = true;
    let parent = null;
    const feedback = node('div'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const actions = node('div', 'qa-actions');
    const submit = node('button', 'qa-primary', isAnswer ? '提交回答' : '提交评论'); submit.type = 'submit';
    actions.append(submit, node('span', 'qa-note', isAnswer ? '回答审核后显示。' : '评论审核后显示。'));
    form.append(replyContext, bodyWrap, actions, feedback); section.append(form); container.append(section);
    markdownTools(body);
    function setReply(item) {
      parent = item.id; replyContext.replaceChildren(node('span', '', '回复 ' + item.nickname + ' '));
      replyContext.append(button('取消回复', () => { parent = null; replyContext.hidden = true; }, 'qa-reply'));
      replyContext.hidden = false; body.focus();
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    list.setReply = setReply;
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      busy(form, async () => {
        feedback.replaceChildren();
        try {
          const name = await visitor();
          await rpc('submit_comment', { p_body: body.value.trim(), p_nickname: name,
            p_thread_id: context.id || null, p_article_path: context.path || null,
            p_article_title: context.title || null, p_parent_id: parent });
          body.value = ''; parent = null; replyContext.hidden = true;
          message(feedback, '已提交，审核通过后就会显示。');
          if (reload) await reload();
        } catch (error) { message(feedback, errorText(error), true); }
      });
    });
  }
  function comments(list, items) {
    list.replaceChildren();
    if (!items.length) { list.append(node('p', 'qa-empty', '还没有公开评论，欢迎交流。')); return; }
    const byId = new Map(items.map(i => [i.id, i]));
    items.forEach(item => {
      const box = node('article', 'qa-comment'); box.id = 'comment-' + item.id;
      box.append(meta(item.nickname, item.created_at, item.is_owner));
      if (item.parent_id && byId.has(item.parent_id)) {
        const p = byId.get(item.parent_id); box.append(node('div', 'qa-quote', '回复 ' + p.nickname + '：' + p.body.slice(0, 160)));
      }
      box.append(markdownBody(item.body, 'qa-message qa-markdown'), button('回复', () => list.setReply && list.setReply(item), 'qa-reply'));
      list.append(box);
    });
  }
  function discussionPager(container, list, context, initial) {
    let items = initial ? initial.messages : [];
    let total = initial ? initial.message_count : 0;
    const more = button('加载更多讨论', async () => {
      more.disabled = true;
      try {
        const data = await rpc('get_thread', { p_id: context.id || null, p_path: context.path || null, p_offset: items.length });
        if (data) {
          const unique = new Map(items.concat(data.messages).map(item => [item.id, item]));
          items = Array.from(unique.values()); total = data.message_count;
        } else total = items.length;
        comments(list, items); more.hidden = items.length >= total; feedback.replaceChildren();
      } catch (error) { message(feedback, errorText(error), true); }
      finally { more.disabled = false; }
    });
    const feedback = node('div'); feedback.setAttribute('role', 'status');
    more.hidden = items.length >= total; container.append(more, feedback); comments(list, items);
  }
  const feedCleanups = [];
  const threadCache = new Map();
  const answerJobs = []; let activeAnswerJobs = 0;
  function queueAnswers(job) {
    answerJobs.push(job);
    function drain() {
      while (activeAnswerJobs < 4 && answerJobs.length) {
        activeAnswerJobs++;
        Promise.resolve().then(answerJobs.shift()).finally(() => { activeAnswerJobs--; drain(); });
      }
    }
    drain();
  }
  function avatar(owner) {
    const box = node('span', 'qa-feed-avatar'); box.setAttribute('aria-hidden', 'true');
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.2 0-7 2.2-7 5v1h14v-1c0-2.8-2.8-5-7-5Z');
    svg.append(path); box.append(svg);
    if (owner) {
      const img = node('img'); img.src = '/images/avatar.jpg'; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', () => img.remove(), { once: true }); box.append(img);
    }
    return box;
  }
  function feedMeta(item, role) {
    const m = meta(item.nickname, item.created_at, item.is_owner);
    m.classList.add('qa-feed-meta'); m.append(node('span', 'qa-feed-role', role)); return m;
  }
  function expandableText(value, key) {
    const wrap = node('div', 'qa-expandable'), text = markdownBody(value, 'qa-feed-text is-collapsed');
    text.id = 'text-' + key;
    let expanded = false;
    const toggle = button('查看更多', () => {
      expanded = !expanded; text.classList.toggle('is-collapsed', !expanded);
      toggle.textContent = expanded ? '收起' : '查看更多'; toggle.setAttribute('aria-expanded', String(expanded));
    }, 'qa-expand-toggle');
    toggle.setAttribute('aria-controls', text.id); toggle.setAttribute('aria-expanded', 'false'); toggle.hidden = true;
    wrap.append(text, toggle);
    function measure() { if (!expanded) toggle.hidden = text.scrollHeight <= text.clientHeight + 1; }
    if (window.ResizeObserver) { const observer = new ResizeObserver(measure); observer.observe(text); feedCleanups.push(() => observer.disconnect()); }
    requestAnimationFrame(measure); return wrap;
  }
  function feedQuestion(item, initial = null) {
    const box = node('article', 'qa-feed-post'); box.id = 'question-' + item.id; box.setAttribute('aria-label', item.nickname + '的提问');
    const row = node('div', 'qa-feed-row'), content = node('div', 'qa-feed-content');
    row.append(avatar(false), content); box.append(row);
    content.append(feedMeta(item, '提问：'), expandableText(item.body, item.id));
    const answers = node('div', 'qa-feed-answers'), state = node('div'), formHost = node('div', 'qa-feed-form');
    state.setAttribute('role', 'status'); formHost.hidden = true;
    const actions = node('div', 'qa-feed-actions');
    let formMade = false;
    function ensureForm() {
      if (!formMade) { commentForm(formHost, { id: item.id, formId: 'qa-answer-' + item.id }, answers, null); formMade = true; }
      formHost.hidden = false; participate.setAttribute('aria-expanded', 'true'); participate.textContent = '收起输入框';
    }
    const participate = button('参与回答', () => {
      if (!formHost.hidden) { formHost.hidden = true; participate.setAttribute('aria-expanded', 'false'); participate.textContent = '参与回答'; }
      else { ensureForm(); $('textarea', formHost).focus(); }
    }, 'qa-feed-action');
    participate.setAttribute('aria-expanded', 'false');
    actions.append(participate); content.append(answers, state, actions, formHost);
    let messages = [], count = 0;
    const moreAnswers = button('查看更多回答', async () => {
      moreAnswers.disabled = true;
      try {
        const data = await rpc('get_thread', { p_id: item.id, p_offset: messages.length });
        if (data) {
          const ids = new Set(messages.map(m => m.id));
          data.messages.forEach(m => { if (!ids.has(m.id)) messages.push(m); }); count = data.message_count;
          drawAnswers(); state.replaceChildren();
        } else { moreAnswers.hidden = true; message(state, '该问题暂不可见，请刷新页面。'); }
      } catch (error) { message(state, errorText(error), true); }
      finally { moreAnswers.disabled = false; }
    }, 'qa-feed-action');
    content.insertBefore(moreAnswers, actions); moreAnswers.hidden = true;
    function drawAnswers() {
      answers.replaceChildren(); const byId = new Map(messages.map(m => [m.id, m]));
      messages.forEach(m => {
        const answer = node('div', 'qa-feed-row qa-feed-answer'), body = node('div', 'qa-feed-content');
        answer.append(avatar(m.is_owner), body); body.append(feedMeta(m, m.parent_id ? '回复：' : '回答：'));
        if (m.parent_id && byId.has(m.parent_id)) body.append(node('div', 'qa-quote', '回复 ' + byId.get(m.parent_id).nickname + '：' + byId.get(m.parent_id).body.slice(0, 120)));
        body.append(expandableText(m.body, m.id), button('回复', () => { ensureForm(); answers.setReply(m); }, 'qa-feed-action'));
        answers.append(answer);
      });
      moreAnswers.hidden = messages.length >= count;
    }
    async function loadAnswers() {
      if (!box.isConnected) return;
      state.textContent = '正在加载回答…'; state.className = 'qa-note';
      try {
        let promise = threadCache.get(item.id);
        if (!promise) { promise = rpc('get_thread', { p_id: item.id }); threadCache.set(item.id, promise); }
        const data = await promise;
        if (!box.isConnected) return;
        if (!data) { message(state, '该问题暂不可见，请刷新页面。'); return; }
        messages = data.messages; count = data.message_count; drawAnswers(); state.replaceChildren();
      } catch (error) {
        threadCache.delete(item.id); message(state, errorText(error), true);
        state.append(button('重新加载回答', loadAnswers, 'qa-feed-action'));
      }
    }
    if (initial) { messages = initial.messages; count = initial.message_count; drawAnswers(); }
    else if (item.comment_count > 0) {
      if (window.IntersectionObserver) {
        const observer = new IntersectionObserver(entries => {
          if (entries.some(e => e.isIntersecting)) { observer.disconnect(); queueAnswers(loadAnswers); }
        }, { rootMargin: '400px' }); observer.observe(box); feedCleanups.push(() => observer.disconnect());
      } else queueAnswers(loadAnswers);
    }
    return box;
  }
  async function questionList() {
    const list = $('#qa-list'), feedback = $('#qa-list-feedback'), pager = $('#qa-pagination');
    const previous = $('#qa-prev'), next = $('#qa-next'), pageLabel = $('#qa-page-label');
    let page = Math.max(1, Math.min(5000, Number.parseInt(new URLSearchParams(location.search).get('page'), 10) || 1));
    let loading = false; const pages = new Map();
    function getPage(n) {
      if (!pages.has(n)) pages.set(n, rpc('list_questions', { p_offset: (n - 1) * 20 }).catch(error => { pages.delete(n); throw error; }));
      return pages.get(n);
    }
    async function load(target = page, scroll = false) {
      if (loading) return; loading = true;
      const oldPrevious = previous.disabled, oldNext = next.disabled;
      previous.disabled = true; next.disabled = true;
      try {
        let data = await getPage(target);
        if (!data.length && target > 1) { target--; data = await getPage(target); }
        page = target;
        feedCleanups.splice(0).forEach(cleanup => cleanup()); answerJobs.splice(0); list.replaceChildren();
        data.forEach(item => list.append(feedQuestion(item)));
        feedback.replaceChildren();
        if (!data.length) list.append(node('p', 'qa-empty', '暂时还没有公开问题，欢迎留下你的问题。'));
        const url = new URL(location.href); page > 1 ? url.searchParams.set('page', page) : url.searchParams.delete('page');
        history.replaceState(null, '', url); previous.disabled = page === 1; pageLabel.textContent = '第 ' + page + ' 页';
        let hasNext = false;
        if (data.length === 20) {
          try { hasNext = (await getPage(page + 1)).length > 0; }
          catch (_) { hasNext = true; }
        }
        next.disabled = !hasNext; pager.hidden = page === 1 && !hasNext;
        if (scroll) list.scrollIntoView({ block: 'start' });
      } catch (error) {
        previous.disabled = oldPrevious; next.disabled = oldNext;
        message(feedback, errorText(error), true); feedback.append(button('重新加载', () => load(target, scroll), 'qa-feed-action'));
      } finally { loading = false; }
    }
    previous.addEventListener('click', () => load(page - 1, true)); next.addEventListener('click', () => load(page + 1, true));
    const form = $('#qa-question-form'), feedbackForm = $('#qa-question-feedback');
    const questionBody = $('[name=body]', form), questionButton = $('[type=submit]', form);
    markdownTools(questionBody);
    function syncQuestionButton() { questionButton.disabled = !questionBody.value.trim(); }
    questionBody.addEventListener('input', syncQuestionButton);
    syncQuestionButton();
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const body = $('[name=body]', form).value.trim();
      if (!body) { message(feedbackForm, '请填写你的问题。', true); return; }
      const compact = body.replace(/\s+/g, ' ');
      const beginning = compact.split(/[。？！?!]/)[0] || compact;
      const chars = Array.from(beginning);
      const title = chars.slice(0, 60).join('') + (chars.length > 60 ? '…' : '');
      questionButton.textContent = '提交中…'; form.setAttribute('aria-busy', 'true');
      busy(form, async () => {
        feedbackForm.replaceChildren();
        try {
          const name = await visitor();
          await rpc('submit_question', { p_title: title, p_body: body, p_nickname: name });
          $('[name=body]', form).value = '';
          message(feedbackForm, '问题已提交，回答后会显示在下方。');
        } catch (error) { message(feedbackForm, errorText(error), true); }
      }).finally(() => {
        questionButton.textContent = '提交问题'; form.setAttribute('aria-busy', 'false'); syncQuestionButton();
      });
    });
    await load();
  }
  async function thread(id) {
    const content = $('#qa-thread-content'), feedback = $('#qa-thread-feedback');
    try {
      const data = await rpc('get_thread', { p_id: id });
      if (!data) { message(feedback, '该问题尚未公开或不存在。'); return; }
      document.title = data.title + ' | 猎头张振';
      content.append(feedQuestion(data, data));
      feedback.replaceChildren();
    } catch (error) { message(feedback, errorText(error), true); }
  }
  async function article() {
    let path; try { path = decodeURI(location.pathname); } catch (_) { path = location.pathname; }
    path = path.replace(/index\.html$/, '').replace(/\/?$/, '/');
    const title = document.querySelector('.article-title')?.textContent.trim() || document.title.split('|')[0].trim();
    root.append(node('h2', '', '评论'), node('p', 'qa-muted', '欢迎交流。评论审核后公开，张振可以在这里回复你。'));
    const discussion = node('div'), list = node('div'), feedback = node('div'); feedback.setAttribute('role', 'status');
    discussion.append(feedback, list); root.append(discussion);
    async function load() {
      try { const data = await rpc('get_thread', { p_path: path }); discussionPager(list.parentNode, list, { path }, data); feedback.replaceChildren(); }
      catch (error) { message(feedback, errorText(error), true); }
    }
    commentForm(root, { path, title }, list, null); await load();
  }
  async function admin() {
    const login = $('#qa-login'), board = $('#qa-admin-board'), loginFeedback = $('#qa-login-feedback');
    const list = $('#qa-admin-list'), feedback = $('#qa-admin-feedback'), status = $('#qa-admin-status'), more = $('#qa-admin-more');
    let offset = 0;
    function showLogin() { board.hidden = true; login.hidden = false; }
    async function load(reset = true) {
      if (reset) { offset = 0; list.replaceChildren(); }
      feedback.replaceChildren(); more.disabled = true;
      try {
        const items = await rpc('admin_queue', { p_status: status.value, p_offset: offset });
        items.forEach(item => {
          const card = node('article', 'qa-admin-card');
          card.append(node('p', 'qa-muted', item.type === 'question' ? '问题' : '评论 · ' + item.title));
          if (item.type === 'question') card.append(node('h2', '', item.title));
          card.append(meta(item.nickname, item.created_at));
          if (item.parent_body) card.append(node('div', 'qa-quote', '回复：' + item.parent_body.slice(0, 240)));
          card.append(node('div', 'qa-message', item.body));
          const actions = node('div', 'qa-actions'), localFeedback = node('div'); localFeedback.setAttribute('role', 'status');
          async function moderate(next) {
            await busy(card, async () => {
              try { await rpc('admin_moderate', { p_id: item.id, p_type: item.type, p_status: next }); await load(); }
              catch (error) { message(localFeedback, errorText(error), true); }
            });
          }
          if (item.status !== 'published') actions.append(button('审核通过', () => moderate('published'), 'qa-primary'));
          if (item.status !== 'hidden') actions.append(button('隐藏', () => moderate('hidden')));
          if (item.status === 'published') {
            const a = node('a', '', '查看公开页面');
            a.href = item.article_path ? encodeURI(item.article_path) + '#comments' : '/qa/?id=' + item.thread_id;
            a.target = '_blank'; a.rel = 'noopener'; actions.append(a);
          }
          const reply = node('form', 'qa-form'); reply.method = 'post';
          const replyLabel = node('label', '', '以“猎头张振”身份回复');
          const body = node('textarea'); body.required = true; body.maxLength = 6000; body.rows = 6;
          body.id = 'reply-' + item.id; replyLabel.htmlFor = body.id;
          const send = node('button', 'qa-primary', item.status === 'published' ? '发布回复' : '审核通过并回复'); send.type = 'submit';
          reply.append(replyLabel, body, send);
          markdownTools(body);
          reply.addEventListener('submit', event => {
            event.preventDefault(); if (!reply.reportValidity()) return;
            busy(card, async () => {
              try {
                await rpc('admin_reply', { p_body: body.value.trim(), p_id: item.id, p_type: item.type });
                body.value = '';
                await load();
              } catch (error) { message(localFeedback, errorText(error), true); }
            });
          });
          card.append(actions, reply, localFeedback); list.append(card);
        });
        offset += items.length; more.hidden = items.length < 50;
        if (!offset) list.append(node('p', 'qa-empty', '这里暂时没有内容。'));
      } catch (error) { message(feedback, errorText(error), true); }
      finally { more.disabled = false; }
    }
    async function verify() {
      const { data } = await client.auth.getSession();
      if (!data.session) { showLogin(); return; }
      if (!(await rpc('admin_status'))) {
        await client.auth.signOut(); showLogin(); message(loginFeedback, '这个账户还没有站长权限，请先完成后台授权。', true); return;
      }
      login.hidden = true; board.hidden = false; await load();
    }
    login.addEventListener('submit', event => {
      event.preventDefault();
      busy(login, async () => {
        try {
          const { error } = await client.auth.signInWithPassword({ email: $('[name=email]', login).value.trim(), password: $('[name=password]', login).value });
          if (error) throw error;
          $('[name=password]', login).value = ''; loginFeedback.replaceChildren(); await verify();
        } catch (error) { message(loginFeedback, errorText(error), true); }
      });
    });
    $('#qa-logout').addEventListener('click', async () => { await client.auth.signOut(); list.replaceChildren(); showLogin(); });
    $('#qa-refresh').addEventListener('click', () => load()); status.addEventListener('change', () => load()); more.addEventListener('click', () => load(false));
    try { await verify(); } catch (error) { showLogin(); message(loginFeedback, errorText(error), true); }
  }
  if (!client) { root.append(node('p', 'qa-feedback', '问答功能暂时未加载，请刷新后重试。')); return; }
  if (mode === 'admin') admin();
  else if (mode === 'article') article();
  else {
    const id = new URLSearchParams(location.search).get('id');
    if (id) {
      $('#qa-home').hidden = true; $('#qa-thread').hidden = false;
      if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) thread(id);
      else message($('#qa-thread-feedback'), '问题地址无效。', true);
    } else questionList();
  }
})();
