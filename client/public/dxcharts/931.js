/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x3a3],{0x6620:(a,b,c)=>{c['d'](b,{'BF':()=>r,'T5':()=>s,'v3':()=>w,'RQ':()=>t,'M6':()=>u,'at':()=>y,'PY':()=>A,'xK':()=>q,'HQ':()=>p,'k$':()=>v,'Gf':()=>x});var d=c(0x8b0b),e=c(0x12fa0),f=c(0x1610a),g=c(0xfa78),h=c(0xc514),i=c(0x6333),j=c(0x10fc5),k=c(0x2668);;const l=(0x0,e['Ay'])((0x0,k['r']))['withConfig']({'displayName':'DXChart-DropdownMenuSecondaryStyled','componentId':'DXChart-1gffxgq'})`
	background-color: var(--menu-secondary-bg);
	${j['xV']} {
		&:hover {
			background-color: var(--menu-secondary-item-hover-bg);
		}
	}
`;var m=c(0x2a4d),n=c(0xa277),o=c(0x111c4);;const p=(0x0,e['Ay'])((0x0,f['gs']))['withConfig']({'displayName':'DXChart-ChartSettingsTabGeneralItemStyled','componentId':'DXChart-lzkuwf'})`
	&:hover {
		background-color: var(--menu-item-hover-bg);
		border-radius: var(--spacer-1);
	}

	${d['UX']} {
		width: 100%;
		outline: 1px solid transparent;
		background-color: transparent;

		&:focus {
			box-shadow: none;
		}
	}

	${d['mZ']} {
		border: none;
		width: 100%;
		height: 100%;
	}

	${d['GD']} {
		width: 100%;
		height: 100%;
	}

	${B=>B['$keyboardModeEnabled']&&'&:focus-within\x20{\x0a\x09\x09border-radius:\x204px;\x0a\x20\x20\x20\x20\x09box-shadow:\x200\x200\x200\x201px\x20var(--button-primary-default-bg);\x0a\x09}'}
`,q=(0x0,e['Ay'])(p)['withConfig']({'displayName':'DXChart-ChartSettingsTabGeneralItemLineStyled','componentId':'DXChart-xj3odh'})`
	display: flex;
	margin-inline-start: var(--spacer-6);
	&:hover {
		background-color: var(--menu-bg);
	}
`,r=(0x0,e['Ay'])((0x0,o['A']))['withConfig']({'displayName':'DXChart-ChartSettingsTabAdaptivePopoverStyled','componentId':'DXChart-tvfy6u'})`
	margin-top: 0;
`,s=(0x0,e['Ay'])((0x0,g['x']))['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairAnchorStyled','componentId':'DXChart-1dqyfb3'})`
	padding: 0;
	padding-right: var(--spacer-3);
	height: 16px;
	box-sizing: border-box;
	border-radius: 4px;
	background: transparent;
	&:after {
		border: none;
	}
	&:hover {
		background: none;
	}

	${h['XQ']} {
		text-align: left;
		font-size: var(--font-size-m);
		line-height: var(--line-height-m);
		color: var(--menu-active-text);
		font-family: var(--font-main-semibold);
	}

	${h['P3']} {
		width: 20px;
		height: 20px;
	}

	${h['P3']} {
		box-sizing: border-box;
		position: absolute;
		left: calc(100% - 4px);
		top: 0;
		// add transform-origin for the tricky transform: rotate case - the element moves by 1px at the end of the transition
		transform-origin: 10px 9px 0px;
		transition: transform ease 0.4s;
		display: flex;
		align-items: center;
		justify-content: center;
		${B=>B['isOpened']&&(0x0,e['AH'])`
				transform: rotate(180deg);
			`}
	}
`,t=(0x0,e['Ay'])((0x0,i['_']))['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairDropdownMenuItemStyled','componentId':'DXChart-1x1bs31'})`
	padding: var(--spacer-1);
	width: 100%;
	box-sizing: border-box;
	min-width: 0;
	color: var(--menu-primary-text);

	${j['pC']} {
		font-family: var(--font-main-semibold);
		font-size: var(--font-size-m);
		line-height: var(--line-height-m);
	}
`,u=(0x0,e['Ay'])(l)['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairDropdownMenuStyled','componentId':'DXChart-1jpkg2'})`
	width: 80px;
	box-sizing: border-box;
	padding: var(--spacer-1);
`,v=(0x0,e['Ay'])((0x0,m['M']))['withConfig']({'displayName':'DXChart-ChartSettingsTabMenuSelectboxStyled','componentId':'DXChart-1ekvzqy'})`
	margin-inline-start: var(--spacer-1);
	&:hover {
		background-color: var(--menu-item-hover-bg);
	}
`,w=e['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairContainerStyled','componentId':'DXChart-1kvs05l'})`
	display: flex;
	align-items: center;
`,x=(0x0,e['Ay'])(p)['withConfig']({'displayName':'DXChart-ChartSettingsTabPriceTypeContainerStyled','componentId':'DXChart-f9vvoy'})`
	display: flex;
	align-items: center;
	margin-inline-start: var(--spacer-6);

	&:hover {
		background-color: var(--menu-bg);
	}
`,y=e['Ay']['hr']['withConfig']({'displayName':'DXChart-ChartSettingsTabDivider','componentId':'DXChart-1km3yu5'})`
	margin: var(--spacer-0);
	height: 1px;
	border: none;
	background-color: var(--menu-divider);
	visibility: ${B=>B['visible']?'visible':'hidden'};
`,z=(0x0,e['Ay'])((0x0,n['$']))['withConfig']({'displayName':'DXChart-ChartSettingsResetButton','componentId':'DXChart-1cdtfgp'})`
	height: 24px;
	padding: var(--spacer-1);
	font-family: var(--font-main-semibold);
	font-size: var(--font-size-m);
	line-height: var(--line-height-m);
	color: var(--link-default-text);
	margin-top: var(--spacer-3);

	border: 1px solid transparent;

	&:focus {
		border-color: var(--focus-border);
	}
`,A=e['Ay']['form']['withConfig']({'displayName':'DXChart-ChartSettingsTabForm','componentId':'DXChart-1f81gd3'})``;},0xe633:(a,b,c)=>{c['r'](b),c['d'](b,{'ChartSettingsGeneralContainer':()=>E,'default':()=>F});var d=c(0x12e5c),e=c(0xf8d0),f=c(0x8c58),g=c(0x65f5),h=c(0xd114),i=c(0x3ffe),j=c(0x4b31);;const k=(G,H,I)=>{const J={'overrideExisting':!![],'addIfMissing':![]};switch(G){case'candle':case'hollow':case'heikinAshi':case'trend':case'bar':case'line':case'area':case'scatterPlot':case'histogram':case'baseline':return(0x0,j['h1'])((0x0,d['Ql'])(I),l(H),{...J});case'equivolume':return(0x0,j['h1'])((0x0,d['Ql'])(I),m(H),{...J});default:return(0x0,j['h1'])((0x0,d['Ql'])(I),l(H),{...J});}},l=G=>{return{'chartCore':{'components':{'chart':{'equivolume':{'showClosePrice':G['chartCore']['components']['chart']['equivolume']['showClosePrice']}}}}};},m=G=>{return{'chartCore':{'components':{'chart':{'showWicks':G['chartCore']['components']['chart']['showWicks']}}}};};var n=c(0xc138),o=c(0xf3d5),p=c(0x660e),q=c(0xb11b),r=c(0xb116),s=c(0x147f4),t=c(0x61da),u=c(0x8bd),v=c(0x6620),w=c(0x16c65),x=c(0x574e);;const y=(0x0,e['memo'])(G=>{return e['createElement'](v['BF'],{...G,'align':'start','position':'bottom'});});function z(G,H){return H['some'](I=>I===G);}const A=G=>{const {value:H,options:I,keyboardModeEnabled:J,onValueChange:K,tabIndex:L}=G,{localization:M}=(0x0,e['useContext'])(i['e']),N=(0x0,w['sE'])(),O=(0x0,e['useMemo'])(()=>({'C':M['settingsPopup']['tabs']['general']['snapCrosshairTo']['close'],'H':M['settingsPopup']['tabs']['general']['snapCrosshairTo']['high'],'L':M['settingsPopup']['tabs']['general']['snapCrosshairTo']['low'],'O':M['settingsPopup']['tabs']['general']['snapCrosshairTo']['open'],'OHLC':M['settingsPopup']['tabs']['general']['snapCrosshairTo']['OHLC'],'none':M['settingsPopup']['tabs']['general']['snapCrosshairTo']['none']}),[M]),[P,Q]=(0x0,e['useState'])(![]),R=(0x0,e['useCallback'])(S=>{z(S,I)&&K(S);},[K,I]);return e['createElement'](v['k$'],{'tabIndex':L,'value':H,'onValueChange':R,'onToggle':Q,'isOpened':P,'Popover':y,'Anchor':v['T5'],'Menu':v['M6'],'keyboardMode':J,'caretIcon':N['selectBox']['arrow']},I['map'](S=>{const T=H===S;return e['createElement'](v['RQ'],{'key':S,'value':S,'isActive':T,'label':O[S]},O[S]);}));},B=(0x0,x['v'])(A);;const C=(0x0,e['memo'])(G=>{const {value:H,localization:I,onValueChange:J,onRestoreDefaultRequest:onRestoreDefaultRequest=n['Yi'],a11yTabProps:K,showRestoreToDefault:showRestoreToDefault=![],chartType:L}=G,{chartCore:M}=H,N=(0x0,e['useCallback'])(Y=>{const Z=Y?'cross-and-labels':'none';J((0x0,r['K'])(['chartCore','components','crossTool','type']),Z);},[J]),O=(0x0,e['useCallback'])((Y=![])=>{J((0x0,r['K'])(['chartCore','components','grid','vertical']),Y);},[J]),P=(0x0,e['useCallback'])((Y=![])=>{J((0x0,r['K'])(['chartCore','components','grid','horizontal']),Y);},[J]),Q=(0x0,e['useCallback'])((Y=![])=>{J((0x0,r['K'])(['chartCore','components','chart','showWicks']),Y);},[J]),R=(0x0,e['useCallback'])((Y=![])=>{J((0x0,r['K'])(['chartCore','components','highLow','visible']),Y);},[J]),S=(0x0,e['useCallback'])((Y=![])=>{J((0x0,r['K'])(['chartCore','components','waterMark','visible']),Y);},[J]),T=(0x0,e['useCallback'])(Y=>{J((0x0,r['K'])(['chartCore','components','crossTool','magnetTarget']),Y),Y!=='none'&&N(!![]);},[J,N]),U=(0x0,e['useCallback'])(Y=>{J((0x0,r['K'])(['chartCore','components','chart','equivolume','showClosePrice']),Y);},[J]),{keyboardModeEnabled:V}=(0x0,e['useContext'])(i['e']),W=(0x0,e['useMemo'])(()=>(0x0,q['w3'])(L),[L]),X=(0x0,e['useMemo'])(()=>{return I['settingsPopup']['tabs']['general']['crosshair']+',\x20'+(''+I['settingsPopup']['tabs']['general']['snapCrosshairTo']['title'])['toLowerCase']();},[I]);return e['createElement'](u['au'],{'data-test-id':p['Y']['chart_settings_tab_general_content']},e['createElement'](v['PY'],{'role':K?.['role'],'id':K?.['id'],'aria-labelledby':K?.['ariaLabelledBy']},e['createElement'](s['z'],{'label':I['settingsPopup']['tabs']['general']['highLow'],'value':M['components']['highLow']['visible'],'onValueChange':R}),e['createElement'](s['z'],{'label':I['settingsPopup']['tabs']['general']['horizontalGrid'],'value':M['components']['grid']['horizontal'],'onValueChange':P}),e['createElement'](s['z'],{'label':I['settingsPopup']['tabs']['general']['verticalGrid'],'value':M['components']['grid']['vertical'],'onValueChange':O}),L!=='equivolume'&&e['createElement'](s['z'],{'label':I['settingsPopup']['tabs']['general']['candleWick'],'value':M['components']['chart']['showWicks'],'onValueChange':Q}),L==='equivolume'&&e['createElement'](s['z'],{'label':I['settingsPopup']['tabs']['general']['showClosePrice'],'value':M['components']['chart']['equivolume']['showClosePrice'],'onValueChange':U}),e['createElement'](s['z'],{'label':I['settingsPopup']['tabs']['general']['watermark'],'value':M['components']['waterMark']['visible'],'onValueChange':S}),e['createElement'](v['HQ'],{'$keyboardModeEnabled':V},e['createElement'](v['v3'],null,e['createElement'](t['s'],{'label':X},e['createElement'](o['S'],{'value':M['components']['crossTool']['type']==='cross-and-labels','onValueChange':N,'testId':p['Y']['chart_settings_checkbox']})),e['createElement'](B,{'onValueChange':T,'value':M['components']['crossTool']['magnetTarget'],'options':W,'keyboardModeEnabled':V,'tabIndex':M['components']['crossTool']['type']!=='cross-and-labels'?-0x1:0x0})))),showRestoreToDefault&&e['createElement'](u['ov'],{'onClick':onRestoreDefaultRequest},I['settingsPopup']['resetToDefaultsBtn']));}),D=null&&C;;const E=f['_O']['combine'](f['_O']['key']()('chartConfiguratorViewModel'),f['_O']['key']()('chartTypeViewModel'),(G,H)=>(0x0,g['s'])('ChartSettingsGeneralContainer',I=>{const {localization:J}=(0x0,e['useContext'])(i['e']),K=(0x0,h['k'])(G['state'],['settings']),{defaultConfig:L,a11yTabProps:M}=I,N=(0x0,h['N'])(H['type']),O=(0x0,e['useMemo'])(()=>k(N,K,L),[N,K,L]),P=(0x0,e['useMemo'])(()=>!(0x0,d['bD'])(O,K),[K,O]),Q=(0x0,e['useCallback'])(()=>G['onRestoreDefaultConfigTab'](O),[O]);return(0x0,e['createElement'])(C,{'chartType':N,'showRestoreToDefault':P,'localization':J,'onValueChange':G['setSettingsByPath'],'value':K,'onRestoreDefaultRequest':Q,'a11yTabProps':M});})),F=E;},0x147f4:(a,b,c)=>{c['d'](b,{'z':()=>j});var d=c(0xf8d0),e=c(0xf3d5),f=c(0x3ffe),g=c(0x61da),h=c(0x6620),i=c(0x660e);const j=(0x0,d['memo'])(k=>{const {label:l,value:m,onValueChange:n,disabled:disabled=![],fieldTestId:o}=k,{keyboardModeEnabled:p}=(0x0,d['useContext'])(f['e']);return d['createElement'](h['HQ'],{'$keyboardModeEnabled':p},d['createElement'](g['s'],{'label':l,'isDisabled':disabled,'testId':o},d['createElement'](e['S'],{'isDisabled':disabled,'value':m,'onValueChange':n,'data-test-id':i['Y']['chart_settings_checkbox']})));});},0x1610a:(a,b,c)=>{c['d'](b,{'VU':()=>f,'gs':()=>j});var d=c(0x12fa0);const e=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldset','componentId':'DXChart-1hmow83'})`
	display: flex;
	flex-wrap: wrap;
	border: 0;
	margin: 0;
	font: inherit;
	border-top: 1px solid var(--menu-divider);
	padding: var(--spacer-3) var(--spacer-6) var(--spacer-6) var(--spacer-1);

	&:first-child {
		border-top: none;
	}
`,f=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetContainer','componentId':'DXChart-2uo8j'})`
	display: flex;
	flex-direction: column;
`,g=d['Ay']['h3']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetHeader','componentId':'DXChart-kh4jvg'})`
	display: block;
	color: var(--form-title-text);
	font-size: var(--font-size-m);
	line-height: var(--line-height-l);
	font-family: var(--font-main-bold);
	text-transform: uppercase;
	letter-spacing: 0.84px;
	margin: 0;
	margin-bottom: var(--spacer-2);
	margin-left: var(--spacer-2);
`,h=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetBody','componentId':'DXChart-1ua2u5a'})`
	display: flex;
	flex-wrap: wrap;
`,i=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetGroup','componentId':'DXChart-1o3n007'})`
	${l=>l['vertical']?(0x0,d['AH'])`
					&:not(:first-child) {
						margin-top: var(--spacer-2);
					}
			  `:(0x0,d['AH'])`
					&:not(:last-child) {
						margin-right: var(--spacer-2);
					}
			  `}
`,j=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetGroupItem','componentId':'DXChart-15kedd4'})`
	width: auto;
	box-sizing: border-box;
	margin: 0;
	margin-bottom: var(--spacer-1);
	padding: var(--spacer-05) var(--spacer-1);
`,k=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetGroupItemText','componentId':'DXChart-1tgyoyg'})`
	font-family: var(--font-main-semibold);
	font-size: var(--font-size-m);
	line-height: var(--line-height-m);
	color: var(--menu-primary-text);
	margin-bottom: var(--spacer-2);
`;}}]);