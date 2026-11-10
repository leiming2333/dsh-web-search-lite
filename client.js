window.__ModuleLoader__.load({
	id: 'dsh-web-search-lite',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');
		const h = React.createElement;
		const { useCallback, useEffect, useRef, useState } = React;

		/** Dictionary namespace owned by this plugin. */
		const NS = 'settings.webSearchPro';
		/** Section id in the Settings page. */
		const SECTION = 'web-search-pro';
		/** Route prefix the Host half serves. */
		const API = '/api/web-search-pro';

		/** Where the Host keeps this plugin's settings, shown when the API is unreachable. */
		const SETTINGS_FILE_HINT = '%USERPROFILE%\\.dsh\\web-search-pro\\settings.json（或 $DSH_HOME/web-search-pro/settings.json）';

		/** A minimal settings record a user can paste in while the settings API is down. */
		const SETTINGS_TEMPLATE = [
			'{',
			'  "provider": "duckduckgo",',
			'  "apiKey": "",',
			'  "endpoint": "",',
			'  "maxResults": 8,',
			'  "timeoutMs": 20000,',
			'  "language": "",',
			'  "includeAnswer": true,',
			'  "enableFetch": true,',
			'  "fetchMaxChars": 20000',
			'}',
		].join('\n');

		/** Copy for the Settings section. */
		const en = {
			nav: 'Web search',
			title: 'Web search',
			intro:
				'Give the assistant a real search: it can look up current information and open the pages it finds. The engines under "no key" work immediately; an API key makes results steadier.',
			groupFree: 'No API key needed',
			groupKeyed: 'Requires an API key',
			provider: 'Provider',
			providerHint:
				'Each API provider has its own key and quota. The no-key engines are read from their public results page: nothing to sign up for, but a redesign or bot check can break them for a while. Pick a single engine only if one keeps failing.',
			noKeyNeeded: 'This engine needs no key.',
			aggregateHint:
				'Aggregate queries every no-key engine above, plus each API provider below that has a key. Providers without a key are skipped instead of failing.',
			fanoutHint:
				'Queries DuckDuckGo, Bing 网页, 百度 and 360 at the same time, then merges and de-duplicates what they return. Slower than one engine (about the slowest of them), and steadier: one engine failing only costs its share of the results.',
			scrapeHint:
				'Results come from the engine\'s public web page. If it starts refusing automated requests, switch engines or configure an API key.',
			apiKey: 'API key',
			apiKeyHint:
				"Stored in this machine's DSH state directory. Leave empty to keep the current key.",
			apiKeyUnused: 'Not used by the selected engine. Switching to an API provider brings this back.',
			apiKeyPlaceholder: 'Paste a key to set or replace it',
			apiKeySet: 'A key is configured: ',
			apiKeyUnset: 'No key configured yet.',
			apiKeyClear: 'Clear key',
			apiKeyShow: 'Show',
			apiKeyHide: 'Hide',
			apiKeyDocs: 'Get a key',
			engineHome: 'Open site',
			endpoint: 'Endpoint',
			endpointHint:
				"Optional. Leave empty to use the provider's official URL; required for SearXNG, for example https://searx.example.com",
			results: 'Results per search',
			resultsHint: 'How many sources one search returns, 1 to 50.',
			timeout: 'Timeout (ms)',
			timeoutHint: 'How long one request may take before it is aborted, 1000 to 120000.',
			language: 'Language',
			languageHint: 'Optional hint such as zh-CN or en. Leave empty to let the provider decide.',
			answer: 'Ask for a summary',
			answerHint: 'Tavily and Serper can return a short generated answer beside the sources.',
			fetch: 'Open pages',
			fetchHint:
				'Adds a tool that reads a page as text, so the assistant can follow a search result instead of guessing from its snippet.',
			fetchLimit: 'Page text limit',
			fetchLimitHint: 'Characters kept from one page, 1000 to 200000.',
			save: 'Save',
			saving: 'Saving…',
			saved: 'Saved. Changes apply to the next message.',
			saveFailed: 'Could not save: ',
			discard: 'Discard changes',
			unsaved: 'Unsaved changes',
			loading: 'Loading…',
			loadFailed: 'Could not read the settings from the Host: ',
			reload: 'Retry',
			hostMissing:
				'The Host half of this plugin is not running, so there is no settings API to talk to. This almost always means the app was not restarted after the plugin was installed or updated — refreshing the page is not enough, because the browser half reloads on its own while the Host keeps its boot-time plugin set. Quit DeepSeek Harness completely and start it again, then reopen this page.',
			hostGeneric: 'If this keeps happening after a restart, the Host log line starting with "web-search-pro:" says which stage failed.',
			fileHint: 'Meanwhile you can edit the settings file directly:',
			fileTemplate: 'Then restart again. The keys are the same ones the form below writes.',
			invalidResults: 'Enter a whole number from 1 to 50.',
			invalidTimeout: 'Enter a whole number from 1000 to 120000.',
			invalidFetchLimit: 'Enter a whole number from 1000 to 200000.',
			test: 'Test connection',
			testing: 'Testing…',
			testOk: 'Search works',
			testFailed: 'Search failed',
			testSources: 'sources',
			testHint: 'Runs one real query through the saved settings, so save first if you just changed something.',
			verifyTitle: 'Check that it works',
			verifyBody:
				'Or ask in a chat: “搜索一下今天的科技新闻”. If the key or the endpoint is wrong, the tool reports exactly what the provider answered.',
			problem: 'The settings file could not be read; defaults are shown. Saving will rewrite it.',
		};

		/** Chinese copy, checked against the English keys. */
		const zh = {
			nav: '网络搜索',
			title: '网络搜索',
			intro:
				'给助手接上真正的搜索能力：可以查当前信息，也能打开搜索结果里的网页。「免密钥」的引擎装好即可用；配了 API Key 结果会更稳。',
			groupFree: '免密钥（开箱即用）',
			groupKeyed: '需要 API Key',
			provider: '搜索引擎',
			providerHint:
				'带 API Key 的提供方各有独立密钥与额度。免密钥引擎直接读它的公开结果页：不用注册，但页面改版或反爬时可能暂时失效。单个引擎老失败时再单独选它排查。',
			noKeyNeeded: '这个引擎不需要密钥。',
			aggregateHint:
				'聚合模式会同时调用上面所有免密钥引擎，以及下面这些填了 Key 的提供方。没填 Key 的会被跳过，不会拖累其他引擎。',
			fanoutHint:
				'同时查询 DuckDuckGo、Bing 网页、百度和 360，再把结果合并去重。比只用一个引擎慢一点（取决于最慢的那个），但更稳：某个引擎失败只损失它那一份。',
			scrapeHint: '结果来自该引擎的公开网页。如果它开始拒绝自动访问，换个引擎或配置 API Key。',
			apiKey: 'API Key',
			apiKeyHint: '保存在本机 DSH 状态目录里。留空表示保持当前密钥不变。',
			apiKeyUnused: '当前引擎不使用密钥。切到需要密钥的提供方时会恢复填写。',
			apiKeyPlaceholder: '粘贴密钥以设置或替换',
			apiKeySet: '已配置密钥：',
			apiKeyUnset: '尚未配置密钥。',
			apiKeyClear: '清除密钥',
			apiKeyShow: '显示',
			apiKeyHide: '隐藏',
			apiKeyDocs: '获取密钥',
			engineHome: '打开官网',
			endpoint: '服务地址',
			endpointHint: '可选。留空使用该提供方的官方地址；SearXNG 必填，例如 https://searx.example.com',
			results: '每次搜索的结果数',
			resultsHint: '一次搜索返回多少条来源，1–50。',
			timeout: '超时（毫秒）',
			timeoutHint: '单次请求最长等待时间，1000–120000 毫秒。',
			language: '语言',
			languageHint: '可选，例如 zh-CN 或 en。留空由提供方决定。',
			answer: '请求生成摘要',
			answerHint: 'Tavily 与 Serper 可以在来源之外返回一段简短的生成式摘要。',
			fetch: '读取网页正文',
			fetchHint: '增加一个把网页读成文本的工具，助手可以打开搜索结果，而不是只靠摘要猜测。',
			fetchLimit: '正文长度上限',
			fetchLimitHint: '单个网页保留的字符数，1000–200000。',
			save: '保存',
			saving: '保存中…',
			saved: '已保存，下一条消息就会生效。',
			saveFailed: '保存失败：',
			discard: '放弃修改',
			unsaved: '有未保存的修改',
			loading: '加载中…',
			loadFailed: '读取设置失败：',
			reload: '重试',
			hostMissing:
				'这个插件的「宿主半身」没在运行，所以没有可用的设置接口。通常是因为装好或更新插件后没有重启 DeepSeek Harness——刷新页面不够：浏览器半身会自己重新加载，但宿主仍跑着启动时那批插件。请完全退出 DeepSeek Harness 再打开，然后回到这个页面。',
			hostGeneric: '如果重启后仍然这样，宿主日志里以「web-search-pro:」开头的那行会说明是哪一步失败了。',
			fileHint: '期间你也可以直接改设置文件：',
			fileTemplate: '改完再重启一次。字段名就是下面表单写入的那些。',
			invalidResults: '请填 1–50 的整数。',
			invalidTimeout: '请填 1000–120000 的整数。',
			invalidFetchLimit: '请填 1000–200000 的整数。',
			test: '测试连接',
			testing: '测试中…',
			testOk: '搜索可用',
			testFailed: '搜索失败',
			testSources: '条来源',
			testHint: '用已保存的设置真实跑一次查询；刚改过的话请先保存。',
			verifyTitle: '验证是否可用',
			verifyBody: '也可以在对话里说「搜索一下今天的科技新闻」。密钥或地址不对时，工具会把提供方返回的原因原样报出来。',
			problem: '设置文件读取失败，当前显示的是默认值；保存会重写该文件。',
		};

		/**
		 * Engines shown in the picker, in the same order the Host knows them.
		 *
		 * `needsKey` decides the group and whether the key field applies; `mode` says
		 * how the Host reads the answer, which is what the hint under the picker
		 * explains. `html` engines are read from their public results page, so the
		 * key field is meaningless for them.
		 */
		const PROVIDERS = [
			{ id: 'all', label: '全部引擎', needsKey: false, mode: 'fanout', docs: '' },
			{ id: 'duckduckgo', label: 'DuckDuckGo', needsKey: false, mode: 'html', docs: 'https://duckduckgo.com/' },
			{ id: 'bingweb', label: 'Bing 网页', needsKey: false, mode: 'html', docs: 'https://www.bing.com/' },
			{ id: 'baidu', label: '百度', needsKey: false, mode: 'html', docs: 'https://www.baidu.com/' },
			{ id: 'so360', label: '360 搜索', needsKey: false, mode: 'html', docs: 'https://www.so.com/' },
			{
				id: 'searxng',
				label: 'SearXNG（自建实例）',
				needsKey: false,
				mode: 'json',
				docs: 'https://docs.searxng.org/dev/search_api.html',
			},
			{ id: 'tavily', label: 'Tavily', needsKey: true, mode: 'api', docs: 'https://app.tavily.com/home' },
			{ id: 'serper', label: 'Serper (Google)', needsKey: true, mode: 'api', docs: 'https://serper.dev/api-key' },
			{
				id: 'brave',
				label: 'Brave Search',
				needsKey: true,
				mode: 'api',
				docs: 'https://api.search.brave.com/app/keys',
			},
			{ id: 'exa', label: 'Exa', needsKey: true, mode: 'api', docs: 'https://dashboard.exa.ai/api-keys' },
			{
				id: 'bing',
				label: 'Bing Web Search API',
				needsKey: true,
				mode: 'api',
				docs: 'https://portal.azure.com/',
			},
		];

		/** A provider nobody recognised still shows something usable in the hint. */
		const providerOf = (id) => PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0];

		/**
		 * Read the editable fields out of a Host settings view as strings, so an
		 * emptied number input keeps its empty state while the user is typing.
		 *
		 * `apiKeys` starts empty for every provider: the Host never sends a key back,
		 * only whether one exists. An empty draft therefore means "leave it alone",
		 * and `keyTouched` records which slots the user actually edited.
		 */
		function pick(value) {
			return {
				provider: String(value?.provider ?? 'aggregate'),
				apiKeys: {},
				endpoint: String(value?.endpoint ?? ''),
				maxResults: String(value?.maxResults ?? 8),
				timeoutMs: String(value?.timeoutMs ?? 20000),
				language: String(value?.language ?? ''),
				includeAnswer: value?.includeAnswer !== false,
				enableFetch: value?.enableFetch !== false,
				fetchMaxChars: String(value?.fetchMaxChars ?? 20000),
			};
		}

		/** Parse one integer field, or answer `undefined` when the text is not legal. */
		function wholeNumber(text, min, max) {
			const trimmed = String(text).trim();
			if (!/^\d+$/.test(trimmed)) return undefined;
			const value = Number(trimmed);
			return value >= min && value <= max ? value : undefined;
		}

		/**
		 * The write shape of a draft, or `undefined` when a number field is out of range.
		 *
		 * Drafts keep numbers as text so an emptied input stays empty while typing;
		 * comparing a draft against the Host's view therefore has to happen in the
		 * submitted shape. Otherwise `"8"` would look different from `8` and every
		 * untouched number field would look changed.
		 */
		function submitted(draft, touched = []) {
			const shape = {
				provider: draft.provider,
				endpoint: draft.endpoint.trim(),
				maxResults: wholeNumber(draft.maxResults, 1, 50),
				timeoutMs: wholeNumber(draft.timeoutMs, 1000, 120000),
				language: draft.language.trim(),
				includeAnswer: draft.includeAnswer,
				enableFetch: draft.enableFetch,
				fetchMaxChars: wholeNumber(draft.fetchMaxChars, 1000, 200000),
			};
			// Only the slots the user edited are sent: an untouched field carries no
			// key on this side, and sending an empty string would clear the stored one.
			const keys = {};
			for (const id of touched) {
				if (draft.apiKeys[id] !== undefined) keys[id] = draft.apiKeys[id].trim();
			}
			if (Object.keys(keys).length > 0) shape.apiKeys = keys;
			return Object.values(shape).includes(undefined) ? undefined : shape;
		}

		/**
		 * Names of the settings fields whose submitted value differs from the Host's.
		 *
		 * @param draft - submitted shape of what the user typed.
		 * @param saved - submitted shape of what the Host confirmed.
		 * @returns field names to send.
		 */
		function changesBetween(draft, saved) {
			return Object.keys(draft).filter(
				(field) => JSON.stringify(draft[field]) !== JSON.stringify(saved[field]),
			);
		}

		const styles = {
			page: { display: 'grid', gap: '20px', padding: '4px 0 32px', maxWidth: '720px' },
			head: { display: 'grid', gap: '6px' },
			title: {
				margin: 0,
				fontSize: '18px',
				lineHeight: '26px',
				fontWeight: 600,
				color: 'var(--dsw-alias-label-primary, currentColor)',
			},
			intro: {
				margin: 0,
				fontSize: '13px',
				lineHeight: '20px',
				color: 'var(--dsw-alias-label-secondary, currentColor)',
			},
			card: {
				display: 'grid',
				gap: '18px',
				padding: '18px 20px',
				borderRadius: '12px',
				border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.32))',
				background: 'var(--dsw-alias-bg-layer-1, transparent)',
			},
			field: { display: 'grid', gap: '6px' },
			label: {
				fontSize: '13px',
				lineHeight: '20px',
				fontWeight: 500,
				color: 'var(--dsw-alias-label-primary, currentColor)',
			},
			hint: {
				margin: 0,
				fontSize: '12px',
				lineHeight: '18px',
				color: 'var(--dsw-alias-label-tertiary, currentColor)',
			},
			input: {
				boxSizing: 'border-box',
				width: '100%',
				padding: '7px 10px',
				fontSize: '13px',
				lineHeight: '20px',
				fontFamily: 'inherit',
				color: 'var(--dsw-alias-label-primary, currentColor)',
				background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,.08))',
				border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.32))',
				borderRadius: '8px',
				outline: 'none',
			},
			row: { display: 'flex', alignItems: 'center', gap: '8px' },
			inline: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' },
			grow: { display: 'grid', gap: '4px', flex: '1 1 auto', minWidth: 0 },
			link: {
				fontSize: '12px',
				lineHeight: '18px',
				color: 'var(--dsw-alias-link, currentColor)',
				textDecoration: 'none',
				whiteSpace: 'nowrap',
				marginLeft: 'auto',
			},
			button: {
				padding: '6px 14px',
				fontSize: '13px',
				lineHeight: '20px',
				fontFamily: 'inherit',
				borderRadius: '8px',
				cursor: 'pointer',
				border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.32))',
				background: 'transparent',
				color: 'var(--dsw-alias-label-primary, currentColor)',
			},
			buttonPrimary: {
				padding: '6px 18px',
				fontSize: '13px',
				lineHeight: '20px',
				fontWeight: 500,
				fontFamily: 'inherit',
				borderRadius: '8px',
				cursor: 'pointer',
				border: '0.5px solid transparent',
				background: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
				color: '#fff',
			},
			footer: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
			status: {
				fontSize: '12px',
				lineHeight: '18px',
				color: 'var(--dsw-alias-label-secondary, currentColor)',
			},
			error: {
				fontSize: '12px',
				lineHeight: '18px',
				color: 'var(--dsw-alias-state-warn-secondary, #d4380d)',
				whiteSpace: 'pre-wrap',
			},
			note: {
				display: 'grid',
				gap: '4px',
				padding: '12px 14px',
				borderRadius: '10px',
				border: '0.5px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24))',
			},
			badge: {
				fontSize: '12px',
				lineHeight: '18px',
				color: 'var(--dsw-alias-label-secondary, currentColor)',
			},
		};

		/** One switch drawn as a host-shaped button, keeping `role` and `aria-checked`. */
		function Switch(props) {
			const { checked, disabled, label, onChange } = props;
			return h(
				'button',
				{
					type: 'button',
					role: 'switch',
					'aria-checked': checked ? 'true' : 'false',
					'aria-label': label,
					disabled: disabled === true,
					onClick: () => onChange(!checked),
					style: {
						position: 'relative',
						flex: '0 0 auto',
						width: '36px',
						height: '20px',
						padding: 0,
						marginTop: '2px',
						borderRadius: '10px',
						cursor: disabled === true ? 'default' : 'pointer',
						opacity: disabled === true ? 0.5 : 1,
						border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.32))',
						background: checked
							? 'var(--dsw-alias-state-business-primary, #4d6bfe)'
							: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,.24))',
						transition: 'background 120ms ease',
					},
				},
				h('span', {
					style: {
						position: 'absolute',
						top: '2px',
						left: checked ? '18px' : '2px',
						width: '14px',
						height: '14px',
						borderRadius: '50%',
						background: '#fff',
						transition: 'left 120ms ease',
					},
				}),
			);
		}

		/** A labelled control with an optional hint and an optional trailing link. */
		function Field(props) {
			const { label, hint, trailing, children } = props;
			return h(
				'div',
				{ style: styles.field },
				h('div', { style: styles.row }, h('span', { style: styles.label }, label), trailing ?? null),
				children,
				hint === undefined ? null : h('p', { style: styles.hint }, hint),
			);
		}

		/** A labelled switch row: label and hint on the left, the toggle on the right. */
		function ToggleRow(props) {
			const { label, hint, checked, disabled, onChange } = props;
			return h(
				'div',
				{ style: styles.inline },
				h(
					'div',
					{ style: styles.grow },
					h('span', { style: styles.label }, label),
					h('p', { style: styles.hint }, hint),
				),
				h(Switch, { checked, label, disabled, onChange }),
			);
		}

		/**
		 * Call one API route and return its JSON body.
		 *
		 * A non-2xx answer still carries a JSON `error`, so it is surfaced as the
		 * thrown message instead of being reported as a transport failure.
		 */
		async function callApi(route, body) {
			const response = await fetch(`${API}${route}`, {
				method: body === undefined ? 'GET' : 'POST',
				headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				credentials: 'same-origin',
			});
			const text = await response.text();
			let payload;
			try {
				payload = text === '' ? {} : JSON.parse(text);
			} catch {
				throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
			}
			if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
			return payload;
		}

		/**
		 * The Settings section.
		 *
		 * The Host is the single source of truth: the page reads `/settings` once,
		 * keeps a draft, and sends only the fields the user changed. The key never
		 * travels back, so an empty key field means "keep the stored one" and the
		 * Clear button is the only way to remove it.
		 */
		function SettingsPage(props) {
			const { t } = props;
			const alive = useRef(true);
			const [state, setState] = useState({ status: 'loading' });
			const [draft, setDraft] = useState(null);
			const [saved, setSaved] = useState(null);
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState(null);
			const [probe, setProbe] = useState(null);
			const [testing, setTesting] = useState(false);
			const [revealed, setRevealed] = useState(false);
			const [keyTouched, setKeyTouched] = useState(new Set());

			useEffect(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);

			const load = useCallback(async () => {
				setState({ status: 'loading' });
				try {
					const payload = await callApi('/settings');
					if (!alive.current) return;
					const view = payload.settings ?? {};
					setState({ status: 'ready', view });
					setDraft(pick(view));
					setSaved(pick(view));
					setKeyTouched(new Set());
					setNotice(view.problem === undefined ? null : { tone: 'warn', text: t('problem') });
				} catch (error) {
					if (!alive.current) return;
					setState({ status: 'error', message: error?.message ?? String(error) });
				}
			}, [t]);

			useEffect(() => {
				void load();
			}, [load]);

			if (state.status === 'loading') {
				return h(
					'div',
					{ style: styles.page },
					h('div', { style: styles.head }, h('h2', { style: styles.title }, t('title'))),
					h('p', { style: styles.hint }, t('loading')),
				);
			}

			if (state.status === 'error') {
				// A 404 from the app's own web server is the signature of a Host half that
				// never mounted, which is a different problem from a broken route.
				const notFound = /404/.test(state.message ?? '');
				return h(
					'div',
					{ style: styles.page },
					h('div', { style: styles.head }, h('h2', { style: styles.title }, t('title'))),
					h('p', { style: styles.error }, `${t('loadFailed')}${state.message}`),
					notFound ? h('p', { style: styles.hint }, t('hostMissing')) : null,
					h('p', { style: styles.hint }, t('hostGeneric')),
					h(
						'button',
						{ type: 'button', onClick: () => void load(), style: styles.button },
						t('reload'),
					),
					notFound
						? h(
								'div',
								{ style: styles.note },
								h('span', { style: styles.label }, t('fileHint')),
								h('p', { style: styles.hint }, SETTINGS_FILE_HINT),
								h(
									'pre',
									{
										style: {
											margin: 0,
											overflowX: 'auto',
											fontSize: '12px',
											lineHeight: '18px',
											color: 'var(--dsw-alias-label-secondary, currentColor)',
										},
									},
									SETTINGS_TEMPLATE,
								),
								h('p', { style: styles.hint }, t('fileTemplate')),
							)
						: null,
				);
			}

			const view = state.view ?? {};
			const provider = providerOf(draft.provider);
			// Which key fields to show: the selected API provider alone, every keyed
			// provider under aggregate (that is what the mode calls), none otherwise.
			const keyTargets =
				provider.id === 'aggregate'
					? PROVIDERS.filter((item) => item.needsKey)
					: provider.needsKey
						? [provider]
						: [];
			const pending = submitted(draft, [...keyTouched]);
			const baseline = submitted(saved);
			// Key edits are tracked apart from the rest: a slot holds no key on this
			// side, so comparing shapes would either miss an edit or report a phantom.
			const withoutKeys = ({ apiKeys, ...rest }) => rest;
			const dirty = pending === undefined || baseline === undefined
				? true
				: keyTouched.size > 0 || changesBetween(withoutKeys(pending), withoutKeys(baseline)).length > 0;

			const edit = (field, next) => {
				setDraft((current) => ({ ...current, [field]: next }));
				setNotice(null);
			};

			/** Edit one provider's key slot and remember that this slot was touched. */
			const editKey = (id, value) => {
				setDraft((current) => ({ ...current, apiKeys: { ...current.apiKeys, [id]: value } }));
				setKeyTouched((current) => new Set(current).add(id));
				setNotice(null);
			};

			const save = async () => {
				if (busy) return;
				if (pending === undefined) {
					const message =
						wholeNumber(draft.maxResults, 1, 50) === undefined
							? t('invalidResults')
							: wholeNumber(draft.timeoutMs, 1000, 120000) === undefined
								? t('invalidTimeout')
								: t('invalidFetchLimit');
					setNotice({ tone: 'error', text: message });
					return;
				}
				const body = { ...withoutKeys(pending) };
				if (pending.apiKeys !== undefined) body.apiKeys = pending.apiKeys;
				setBusy(true);
				setNotice(null);
				try {
					const payload = await callApi('/settings', body);
					if (!alive.current) return;
					const next = payload.settings ?? {};
					setState({ status: 'ready', view: next });
					setDraft(pick(next));
					setSaved(pick(next));
					setKeyTouched(false);
					setNotice({ tone: 'ok', text: t('saved') });
				} catch (error) {
					if (!alive.current) return;
					setNotice({ tone: 'error', text: `${t('saveFailed')}${error?.message ?? error}` });
				} finally {
					if (alive.current) setBusy(false);
				}
			};

			const runTest = async () => {
				if (testing) return;
				setTesting(true);
				setProbe(null);
				try {
					const payload = await callApi('/test', {});
					if (!alive.current) return;
					setProbe(payload);
				} catch (error) {
					if (!alive.current) return;
					setProbe({ ok: false, error: error?.message ?? String(error) });
				} finally {
					if (alive.current) setTesting(false);
				}
			};

			return h(
				'div',
				{ style: styles.page },
				h(
					'div',
					{ style: styles.head },
					h('h2', { style: styles.title }, t('title')),
					h('p', { style: styles.intro }, t('intro')),
				),
				h(
					'div',
					{ style: styles.card },
					h(
						Field,
						{ label: t('provider'), hint: t('providerHint') },
						h(
							'select',
							{
								value: draft.provider,
								disabled: busy,
								onChange: (event) => edit('provider', event.target.value),
								style: styles.input,
							},
							[
								h(
									'optgroup',
									{ key: 'free', label: t('groupFree') },
									PROVIDERS.filter((item) => !item.needsKey).map((item) =>
										h('option', { key: item.id, value: item.id }, item.label),
									),
								),
								h(
									'optgroup',
									{ key: 'keyed', label: t('groupKeyed') },
									PROVIDERS.filter((item) => item.needsKey).map((item) =>
										h('option', { key: item.id, value: item.id }, item.label),
									),
								),
							],
						),
					),
					...keyTargets.map((target) => {
						const slot = view.apiKeys?.[target.id] ?? { has: false, preview: '' };
						const edited = keyTouched.has(target.id);
						const typed = (draft.apiKeys[target.id] ?? '').trim();
						// What the badge should say: an edited slot reflects the input, an
						// untouched one reflects what the Host reported.
						const has = edited ? typed !== '' : slot.has;
						return h(
							Field,
							{
								key: target.id,
								label: keyTargets.length > 1 ? target.label : t('apiKey'),
								hint: t('apiKeyHint'),
								trailing:
									target.docs === ''
										? null
										: h(
												'a',
												{ style: styles.link, href: target.docs, target: '_blank', rel: 'noopener noreferrer' },
												t('apiKeyDocs'),
											),
							},
							h(
								'div',
								{ style: styles.row },
								h('input', {
									type: revealed ? 'text' : 'password',
									value: draft.apiKeys[target.id] ?? '',
									placeholder: slot.has && !edited ? t('apiKeyPlaceholder') : '',
									disabled: busy,
									autoComplete: 'off',
									spellCheck: false,
									onChange: (event) => editKey(target.id, event.target.value),
									style: { ...styles.input, flex: '1 1 auto', minWidth: 0 },
								}),
								h(
									'button',
									{
										type: 'button',
										onClick: () => setRevealed((current) => !current),
										style: styles.button,
									},
									revealed ? t('apiKeyHide') : t('apiKeyShow'),
								),
								has
									? h(
											'button',
											{
												type: 'button',
												disabled: busy,
												onClick: () => editKey(target.id, ''),
												style: styles.button,
											},
											t('apiKeyClear'),
										)
									: null,
							),
							h(
								'p',
								{ style: styles.badge },
								has ? `${t('apiKeySet')}${edited ? typed : slot.preview}` : t('apiKeyUnset'),
							),
						);
					}),
					keyTargets.length === 0
						? h('p', { style: styles.hint }, t('noKeyNeeded'))
						: null,
					keyTargets.length === 0
						? h('p', { style: styles.hint }, provider.mode === 'fanout' ? t('fanoutHint') : t('scrapeHint'))
						: provider.id === 'aggregate'
							? h('p', { style: styles.hint }, t('aggregateHint'))
							: null,
					h(
						Field,
						{ label: t('endpoint'), hint: t('endpointHint') },
						h('input', {
							type: 'text',
							value: draft.endpoint,
							disabled: busy,
							spellCheck: false,
							onChange: (event) => edit('endpoint', event.target.value),
							style: styles.input,
						}),
					),
					h(
						Field,
						{ label: t('results'), hint: t('resultsHint') },
						h('input', {
							type: 'number',
							min: 1,
							max: 50,
							value: draft.maxResults,
							disabled: busy,
							onChange: (event) => edit('maxResults', event.target.value),
							style: styles.input,
						}),
					),
					h(
						Field,
						{ label: t('timeout'), hint: t('timeoutHint') },
						h('input', {
							type: 'number',
							min: 1000,
							max: 120000,
							step: 1000,
							value: draft.timeoutMs,
							disabled: busy,
							onChange: (event) => edit('timeoutMs', event.target.value),
							style: styles.input,
						}),
					),
					h(
						Field,
						{ label: t('language'), hint: t('languageHint') },
						h('input', {
							type: 'text',
							value: draft.language,
							placeholder: 'zh-CN',
							disabled: busy,
							spellCheck: false,
							onChange: (event) => edit('language', event.target.value),
							style: styles.input,
						}),
					),
					h(ToggleRow, {
						label: t('answer'),
						hint: t('answerHint'),
						checked: draft.includeAnswer,
						disabled: busy,
						onChange: (next) => edit('includeAnswer', next),
					}),
					h(ToggleRow, {
						label: t('fetch'),
						hint: t('fetchHint'),
						checked: draft.enableFetch,
						disabled: busy,
						onChange: (next) => edit('enableFetch', next),
					}),
					h(
						Field,
						{ label: t('fetchLimit'), hint: t('fetchLimitHint') },
						h('input', {
							type: 'number',
							min: 1000,
							max: 200000,
							step: 1000,
							value: draft.fetchMaxChars,
							disabled: busy || !draft.enableFetch,
							onChange: (event) => edit('fetchMaxChars', event.target.value),
							style: styles.input,
						}),
					),
				),
				h(
					'div',
					{ style: styles.footer },
					h(
						'button',
						{
							type: 'button',
							onClick: save,
							disabled: busy || !dirty,
							style: {
								...styles.buttonPrimary,
								opacity: busy || !dirty ? 0.55 : 1,
								cursor: busy || !dirty ? 'default' : 'pointer',
							},
						},
						busy ? t('saving') : t('save'),
					),
					h(
						'button',
						{
							type: 'button',
							onClick: runTest,
							disabled: testing || busy,
							style: styles.button,
						},
						testing ? t('testing') : t('test'),
					),
					dirty
						? h(
								'button',
								{
									type: 'button',
									disabled: busy,
									onClick: () => {
										setDraft(pick(view));
										setKeyTouched(false);
										setNotice(null);
									},
									style: styles.button,
								},
								t('discard'),
							)
						: null,
					h(
						'span',
						{ style: notice?.tone === 'error' ? styles.error : styles.status },
						notice?.text ?? (dirty ? t('unsaved') : ''),
					),
				),
				notice?.tone === 'error' ? null : null,
				probe === null
					? null
					: h(
							'div',
							{ style: styles.note },
							h(
								'span',
								{ style: probe.ok ? styles.label : styles.error },
								probe.ok
									? `${t('testOk')} · ${probe.providerLabel ?? probe.provider} · ${probe.count} ${t('testSources')} · ${probe.elapsedMs}ms`
									: `${t('testFailed')} · ${probe.elapsedMs ?? 0}ms`,
							),
							probe.ok
								? (probe.sources ?? []).slice(0, 3).map((item, index) =>
										h(
											'p',
											{ key: item.url ?? index, style: styles.hint },
											`${index + 1}. ${item.title ?? item.url}`,
										),
									)
								: h('p', { style: styles.error }, String(probe.error ?? '')),
						),
				h(
					'div',
					{ style: styles.note },
					h('span', { style: styles.label }, t('verifyTitle')),
					h('p', { style: styles.hint }, t('verifyBody')),
					h('p', { style: styles.hint }, t('testHint')),
				),
			);
		}

		/** Services this browser half needs. */
		const inject = ['slots', 'locale'];

		/**
		 * Mount the Settings section.
		 *
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-search-pro: dictionaries');
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register(
					{
						name: 'settings.section',
						id: SECTION,
						order: 60,
						label: () => t('nav'),
						locale: NS,
					},
					SettingsPage,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		// Pure helpers and the page, exported so a headless check can exercise the
		// draft/write comparison and the render path without a DOM.
		exports.__test = {
			pick,
			submitted,
			changesBetween,
			wholeNumber,
			providerOf,
			SettingsPage,
			PROVIDERS,
			callApi,
		};
		return module.exports;
	},
});
