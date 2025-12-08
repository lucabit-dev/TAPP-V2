/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x124],{0x8d0:(a,b,c)=>{c['d'](b,{'$':()=>f});var d=c(0xf8d0),e=c(0x1690d);const f=(g,h,i,j,k)=>{return d['createElement'](e['EH'],{'disabled':j},d['createElement'](e['V'],{'disabled':j},h&&i),d['createElement'](e['ng'],null,g),k&&d['createElement'](e['JO'],null,k));};},0xc1d:(a,b,c)=>{c['d'](b,{'G':()=>i});var d=c(0xf8d0),e=c(0x574e),f=c(0xd85f),g=c(0x13c93);function h(n){const {buttons:o,selected:p,onSelect:q,isDisabled:r,className:s,ariaLabel:t,ariaDescribedby:u}=n,[v,w]=(0x0,d['useState'])(p);v!==p&&w(p);const x=(0x0,d['useRef'])(null),y=(0x0,d['useCallback'])(z=>{w(z),q(z);},[q]);return(0x0,f['n'])({'wrapperRef':x,'childrenSelector':'button','role':'radiogroup','childRole':'radio'}),d['createElement'](g['l'],{'aria-label':t,'aria-describedby':u,'ref':x,'className':s},o['map'](z=>{const A=z['type']===v;return d['createElement'](g['H'],{'className':s,'onClick':()=>y(z['type']),'isActive':A,'isFlat':!![],'tabIndex':0x0,'aria-label':z['ariaLabel'],'aria-describedby':z['ariaDescribedby'],'aria-checked':A,'key':''+z['type'],'disabled':r},z['name']);}));}const i=(0x0,e['v'])(h);},0x6620:(a,b,c)=>{c['d'](b,{'BF':()=>r,'T5':()=>s,'v3':()=>w,'RQ':()=>t,'M6':()=>u,'at':()=>y,'PY':()=>A,'xK':()=>q,'HQ':()=>p,'k$':()=>v,'Gf':()=>x});var d=c(0x8b0b),e=c(0x12fa0),f=c(0x1610a),g=c(0xfa78),h=c(0xc514),i=c(0x6333),j=c(0x10fc5),k=c(0x2668);;const l=(0x0,e['Ay'])((0x0,k['r']))['withConfig']({'displayName':'DXChart-DropdownMenuSecondaryStyled','componentId':'DXChart-1gffxgq'})`
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
`,A=e['Ay']['form']['withConfig']({'displayName':'DXChart-ChartSettingsTabForm','componentId':'DXChart-1f81gd3'})``;},0x7cbe:(a,b,c)=>{c['d'](b,{'W':()=>h});var d=c(0x12fa0),e=c(0x111c4),f=c(0x4fb3),g=c(0x1610a);const h=(0x0,d['Ay'])((0x0,e['A']))['withConfig']({'displayName':'DXChart-RCMenuPopover','componentId':'DXChart-1bnd57j'})`
	overflow: visible;

	${f['Kc']} {
		min-width: 180px;
		padding: var(--spacer-1);
		border-radius: var(--spacer-1);
	}
	${g['gs']} {
		margin-bottom: 0;
		padding: var(--spacer-05) var(--spacer-05);
		user-select: none;
	}
`;},0x89fd:(a,b,c)=>{c['d'](b,{'nz':()=>s,'fl':()=>t});var d=c(0xf8d0),e=c(0xb116),f=c(0x3ffe),g=c(0x147f4),h=c(0x6620),i=c(0x8bd),j=c(0x12fa0),k=c(0xc1d),l=c(0x13c93);;const m=(0x0,j['Ay'])((0x0,k['G']))['withConfig']({'displayName':'DXChart-ChartSettingsLegendButtonsStyled','componentId':'DXChart-17youjb'})`
	${l['H']} {
		padding: 0 var(--spacer-1);
		max-height: 16px;
	}
`;var n=c(0xb2e3),o=c(0xa461),p=c(0x16c65),q=c(0x8d0);;const r=(0x0,d['memo'])(v=>{const {elements:w,onSettingsChange:x,settings:y,chartCoreVolumesVisible:z}=v,{localization:A}=(0x0,d['useContext'])(f['e']),B=(0x0,p['sE'])(),C=(0x0,d['useCallback'])(()=>x((0x0,e['K'])(['chartReact','legend','showInstrument']),!y['showInstrument']),[x,y['showInstrument']]),D=(0x0,d['useCallback'])(()=>x((0x0,e['K'])(['chartReact','legend','showOHLC']),!y['showOHLC']),[x,y['showOHLC']]),E=(0x0,d['useCallback'])(()=>x((0x0,e['K'])(['chartReact','legend','showVolume']),!y['showVolume']),[x,y['showVolume']]),F=(0x0,d['useCallback'])(()=>x((0x0,e['K'])(['chartReact','legend','showPeriod']),!y['showPeriod']),[x,y['showPeriod']]);return d['createElement'](d['Fragment'],null,w['map']((G,H)=>{if(d['isValidElement'](G))return d['cloneElement'](G,{'key':'custom-'+H});if(typeof G==='string')switch(G){case'InstrumentNameCheckbox':return d['createElement'](n['cN'],{'key':G+'-'+H,'onItemSelect':C},d['createElement'](n['Jz'],{'value':'instrumentName'},(0x0,q['$'])(A['settingsPopup']['tabs']['legend']['instrumentName'],y['showInstrument'],d['createElement'](o['h'],null,B['yAxisMainPopover']['checkboxTick']))));case'OHLCValuesCheckbox':return d['createElement'](n['cN'],{'key':G+'-'+H,'onItemSelect':D},d['createElement'](n['Jz'],{'value':'ohlcValues'},(0x0,q['$'])(A['settingsPopup']['tabs']['legend']['ohlc'],y['showOHLC'],d['createElement'](o['h'],null,B['yAxisMainPopover']['checkboxTick']))));case'VolumeCheckbox':return d['createElement'](n['cN'],{'key':G+'-'+H,'onItemSelect':E},d['createElement'](n['Jz'],{'value':'volume','disabled':!z},(0x0,q['$'])(A['settingsPopup']['tabs']['legend']['volume'],z&&y['showVolume'],d['createElement'](o['h'],null,B['yAxisMainPopover']['checkboxTick']),!z)));case'PeriodCheckbox':return d['createElement'](n['cN'],{'key':G+'-'+H,'onItemSelect':F},d['createElement'](n['Jz'],{'value':'period'},(0x0,q['$'])(A['settingsPopup']['tabs']['legend']['period'],y['showPeriod'],d['createElement'](o['h'],null,B['yAxisMainPopover']['checkboxTick']))));case'MenuDivider':return d['createElement'](n['jV'],{'key':G+'-'+H,'visible':!![]});default:return null;}return null;}));});;const s=(0x0,d['memo'])(v=>{const {settings:w,onSettingsChange:x,onRestoreDefaultRequest:y,showRestoreToDefault:z,chartCoreVolumesVisible:A}=v,{localization:B}=(0x0,d['useContext'])(f['e']);return d['createElement'](i['au'],null,d['createElement'](t,{'a11yTabProps':v['a11yTabProps'],'onSettingsChange':x,'settings':w,'chartCoreVolumesVisible':A}),z&&d['createElement'](i['ov'],{'onClick':y},B['settingsPopup']['resetToDefaultsBtn']));}),t=(0x0,d['memo'])(v=>{const {onSettingsChange:w,settings:x,a11yTabProps:y,chartCoreVolumesVisible:z,overridenElements:A}=v,{localization:B}=(0x0,d['useContext'])(f['e']),C=(0x0,d['useMemo'])(()=>[{'name':B['settingsPopup']['tabs']['legend']['pinned'],'type':'pinned','ariaLabel':B['settingsPopup']['tabs']['legend']['pinned']},{'name':B['settingsPopup']['tabs']['legend']['floating'],'type':'floating','ariaLabel':B['settingsPopup']['tabs']['legend']['floating']}],[B]),D=(0x0,d['useCallback'])((I=![])=>w((0x0,e['K'])(['chartReact','legend','showInstrument']),I),[w]),E=(0x0,d['useCallback'])((I=![])=>w((0x0,e['K'])(['chartReact','legend','showPeriod']),I),[w]),F=(0x0,d['useCallback'])((I=![])=>w((0x0,e['K'])(['chartReact','legend','showOHLC']),I),[w]),G=(0x0,d['useCallback'])((I=![])=>w((0x0,e['K'])(['chartReact','legend','showVolume']),I),[w]),H=(0x0,d['useCallback'])((I='pinned')=>w((0x0,e['K'])(['chartReact','legend','mode']),I),[w]);if(A&&A['length']>0x0)return d['createElement'](r,{'elements':A,...v});return d['createElement'](h['PY'],{'role':y?.['role'],'id':y?.['id'],'aria-labelledby':y?.['ariaLabelledBy']},d['createElement'](g['z'],{'label':B['settingsPopup']['tabs']['legend']['instrumentName'],'value':x['showInstrument'],'onValueChange':D}),d['createElement'](g['z'],{'label':B['settingsPopup']['tabs']['legend']['ohlc'],'value':x['showOHLC'],'onValueChange':F}),d['createElement'](g['z'],{'disabled':!z,'label':B['settingsPopup']['tabs']['legend']['volume'],'value':z&&x['showVolume'],'onValueChange':G}),d['createElement'](g['z'],{'label':B['settingsPopup']['tabs']['legend']['period'],'value':x['showPeriod'],'onValueChange':E}),![]&&0x0);}),u=null&&s;},0xb2e3:(a,b,c)=>{c['d'](b,{'DT':()=>m,'Jz':()=>i,'Op':()=>k,'VG':()=>j,'cN':()=>h,'jV':()=>n});var d=c(0x12fa0),e=c(0x143fd),f=c(0x145),g=c(0x6620);const h=(0x0,d['Ay'])((0x0,e['W']))['withConfig']({'displayName':'DXChart-RightClickPopoverMenuStyled','componentId':'DXChart-72v1bm'})`
	min-width: 172px;
	margin: 0;
	padding: 0;
	list-style: none;
	position: relative;
	width: 100%;
`,i=(0x0,d['Ay'])((0x0,f['D']))['withConfig']({'displayName':'DXChart-RightClickPopoverMenuItemStyled','componentId':'DXChart-17i043d'})`
	position: relative;
	height: 24px;
	line-height: var(--line-height-s-px);
	margin: 0;
	padding: var(--spacer-1) 0;
	padding-inline-start: var(--spacer-1);
	padding-inline-end: var(--spacer-5);
	user-select: none;
`,j=d['Ay']['div']['withConfig']({'displayName':'DXChart-RightClickPopoverMenuItemLabelStyled','componentId':'DXChart-1xlo6km'})`
	margin-top: 1px;
	margin-inline-start: 22px;
`,k=d['Ay']['span']['withConfig']({'displayName':'DXChart-RightClickTradingBtnsAtLabel','componentId':'DXChart-1nvlfmu'})`
	padding: 0 var(--spacer-1);
	color: var(--chart-databox-disabled-text);
`,l=d['Ay']['div']['withConfig']({'displayName':'DXChart-RightClickMenuPopoverAnchor','componentId':'DXChart-fz5khe'})`
	position: absolute;
	bottom: 0;
	right: 0;
`,m=d['Ay']['div']['withConfig']({'displayName':'DXChart-RightClickMenuPopoverItemWrapper','componentId':'DXChart-5pg88a'})`
	position: relative;

	// this transparent rectangle is needed to avoid closing popover
	// after hovering anchor icon and moving it to popover's content
	&::before {
		position: absolute;
		content: '';
		display: block;
		inset: -6px;
		background: transparent;
	}
`,n=(0x0,d['Ay'])((0x0,g['at']))['withConfig']({'displayName':'DXChart-RightClickMenuDivider','componentId':'DXChart-1yq6vgz'})`
	margin: var(--spacer-1) 0;
`;},0x10eac:(a,b,c)=>{c['r'](b),c['d'](b,{'ChartSettingsLegendContainer':()=>j,'default':()=>k});var d=c(0x12e5c),e=c(0xf8d0),f=c(0x8c58),g=c(0x65f5),h=c(0xc712),i=c(0x89fd);const j=f['_O']['combine'](f['_O']['key']()('chartConfiguratorViewModel'),l=>(0x0,g['s'])('ChartSettingsLegendContainer',m=>{const n=(0x0,h['kH'])(l['state'],['settings','chartReact','legend']),o=(0x0,h['kH'])(l['state'],['settings','chartCore','components','volumes','visible']),{defaultConfig:p}=m,q=(0x0,e['useMemo'])(()=>!(0x0,d['bD'])(p['chartReact']['legend'],n),[n,p]),r=(0x0,e['useCallback'])(()=>l['onRestoreDefaultConfigTab'](p),[p]);return(0x0,e['createElement'])(i['nz'],{'settings':n,'onSettingsChange':l['setSettingsByPath'],'a11yTabProps':m['a11yTabProps'],'showRestoreToDefault':q,'chartCoreVolumesVisible':o,'onRestoreDefaultRequest':r});})),k=j;},0x13c93:(a,b,c)=>{c['d'](b,{'H':()=>g,'l':()=>f});var d=c(0x12fa0),e=c(0xa277);const f=d['Ay']['div']['withConfig']({'displayName':'DXChart-ButtonsRadioGroupStyled','componentId':'DXChart-c1qbei'})`
	display: flex;
`,g=(0x0,d['Ay'])((0x0,e['$']))['withConfig']({'displayName':'DXChart-ButtonsRadioGroupButtonStyled','componentId':'DXChart-1yrmb04'})`
	min-width: auto;
	height: 24px;
	padding-left: var(--spacer-1);
	padding-right: var(--spacer-1);
	color: var(--checkbox-default-text);

	${h=>h['isActive']&&(0x0,d['AH'])`
			transition: 0.2s;
			color: var(--button-primary-default-bg);
			&:hover {
				color: var(--button-primary-default-bg);
			}
		`}

	&:hover {
		background-color: var(--menu-item-hover-bg);
		border-radius: var(--spacer-1);
	}
`;},0x147f4:(a,b,c)=>{c['d'](b,{'z':()=>j});var d=c(0xf8d0),e=c(0xf3d5),f=c(0x3ffe),g=c(0x61da),h=c(0x6620),i=c(0x660e);const j=(0x0,d['memo'])(k=>{const {label:l,value:m,onValueChange:n,disabled:disabled=![],fieldTestId:o}=k,{keyboardModeEnabled:p}=(0x0,d['useContext'])(f['e']);return d['createElement'](h['HQ'],{'$keyboardModeEnabled':p},d['createElement'](g['s'],{'label':l,'isDisabled':disabled,'testId':o},d['createElement'](e['S'],{'isDisabled':disabled,'value':m,'onValueChange':n,'data-test-id':i['Y']['chart_settings_checkbox']})));});},0x1610a:(a,b,c)=>{c['d'](b,{'VU':()=>f,'gs':()=>j});var d=c(0x12fa0);const e=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldset','componentId':'DXChart-1hmow83'})`
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
`;},0x1690d:(a,b,c)=>{c['d'](b,{'EH':()=>j,'JO':()=>s,'K':()=>r,'MI':()=>t,'Ms':()=>u,'Qw':()=>p,'V':()=>n,'Vi':()=>i,'Xt':()=>h,'jF':()=>l,'ng':()=>k,'ub':()=>m});var d=c(0x12fa0),e=c(0xc6b7),f=c(0xb2e3),g=c(0x7cbe);const h=(0x0,d['Ay'])((0x0,g['W']))['withConfig']({'displayName':'DXChart-YAxisMenuStyled','componentId':'DXChart-1nl4tuj'})``,i=(0x0,d['Ay'])((0x0,f['Jz']))['withConfig']({'displayName':'DXChart-YAxisPopoverMenuItemStyled','componentId':'DXChart-t4cy8c'})`
	${v=>v['disabled']&&(0x0,d['AH'])`
			&:hover {
				background: var(--menu-bg);
			}
			color: var(--menu-disabled-text);
		`}
`,j=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisPopoverMenuItemContentStyled','componentId':'DXChart-1lsf5il'})`
	display: flex;
	align-items: center;
	width: inherit;

	${v=>v['disabled']&&(0x0,d['AH'])`
			color: var(--menu-disabled-text);
		`}
`,k=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisPopoverMenuItemContentTextStyled','componentId':'DXChart-17z1jw7'})`
	display: flex;
	align-items: center;
	flex-grow: 1;
	margin-top: 1px;
	margin-left: -2px;
`,l=(0x0,d['Ay'])(k)['withConfig']({'displayName':'DXChart-YAxisPopoverMenuItemContentTextSubStyled','componentId':'DXChart-18mv18i'})`
	margin-left: 1px;
`,m=(0x0,d['Ay'])(i)['withConfig']({'displayName':'DXChart-YAxisPopoverMenuItemLabelsAndLinesStyled','componentId':'DXChart-5o4xyv'})`
	overflow: visible;

	${k} {
		margin-left: var(--spacer-05);
	}
`,n=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisPopoverMenuItemContentIconStyled','componentId':'DXChart-1vuna2u'})`
	width: 20px;
	margin-inline-end: var(--spacer-1);
	color: var(--checkbox-tick-color);

	${e['Y']} {
		width: auto;
		height: auto;

		& svg {
			width: auto;
			height: auto;
		}
	}

	${v=>v['disabled']&&(0x0,d['AH'])`
			color: var(--menu-disabled-text);
		`}
`,o=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisPopoverMoveScaleLabelItem','componentId':'DXChart-qzqg4d'})`
	margin-top: 1px;
	margin-left: 22px;
`,p=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisMainPopoverMenuContainerStyled','componentId':'DXChart-1rfquyy'})`
	box-sizing: border-box;
	height: auto;
	user-select: none;
	margin: 0;
`,q=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisMainPopoverAnchorElement','componentId':'DXChart-13qjg3o'})`
	position: absolute;
	opacity: 0;
	width: 1px;
	height: 1px;
	left: ${v=>v['xPosition']}px;

	${v=>v['yPosition']&&(0x0,d['AH'])`
			top: ${v['yPosition']}px;
		`}
`,r=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisMainPopoverMainSectionStyled','componentId':'DXChart-jd3kr0'})`
	width: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
`,s=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisMainPopoverMenuItemContentArrowIconStyled','componentId':'DXChart-1ys60v0'})`
	position: absolute;
	margin-inline-start: var(--spacer-2);
	color: var(--icon-disabled);
	inset-inline-end: 10px;
	[dir='rtl'] & {
		scale: -1 1;
	}
`,t=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisMainPopoverDivider','componentId':'DXChart-81d7yu'})`
	width: 170px;
	height: 1px;
	margin-top: var(--spacer-1);
	margin-bottom: var(--spacer-1);
	background-color: var(--menu-divider);
`,u=d['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisMainSettingsItemLabelsAndLinesStyled','componentId':'DXChart-1ffq26c'})`
	// this transparent rectangle is needed to avoid closing popover
	// after hovering anchor icon and moving it to popover's content
	&::before {
		position: absolute;
		content: '';
		display: block;
		top: -4px;
		left: -4px;
		bottom: -4px;
		right: -4px;
		background: transparent;
	}
`;}}]);