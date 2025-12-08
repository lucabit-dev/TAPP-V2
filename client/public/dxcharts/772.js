/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x304],{0xc1d:(a,b,c)=>{c['d'](b,{'G':()=>i});var d=c(0xf8d0),e=c(0x574e),f=c(0xd85f),g=c(0x13c93);function h(n){const {buttons:o,selected:p,onSelect:q,isDisabled:r,className:s,ariaLabel:t,ariaDescribedby:u}=n,[v,w]=(0x0,d['useState'])(p);v!==p&&w(p);const x=(0x0,d['useRef'])(null),y=(0x0,d['useCallback'])(z=>{w(z),q(z);},[q]);return(0x0,f['n'])({'wrapperRef':x,'childrenSelector':'button','role':'radiogroup','childRole':'radio'}),d['createElement'](g['l'],{'aria-label':t,'aria-describedby':u,'ref':x,'className':s},o['map'](z=>{const A=z['type']===v;return d['createElement'](g['H'],{'className':s,'onClick':()=>y(z['type']),'isActive':A,'isFlat':!![],'tabIndex':0x0,'aria-label':z['ariaLabel'],'aria-describedby':z['ariaDescribedby'],'aria-checked':A,'key':''+z['type'],'disabled':r},z['name']);}));}const i=(0x0,e['v'])(h);},0x2cc3:(a,b,c)=>{c['d'](b,{'M':()=>r});var d=c(0xce1c),e=c(0x63b0),f=c(0x17f62),g=c(0x14ffb),h=c(0x5a2c),i=c(0x15cc3),j=c(0x169cf),k=c(0x8c58),l=c(0x108b6),m=c(0x6f9),n=c(0x10ff1),o=c(0x3075),p=c(0xc138),q=c(0x170c1);const r=k['_O']['combine'](k['_O']['key']()('chart'),k['_O']['key']()('actionsHistoryVM'),k['_O']['key']()('studiesSettingsViewModel'),k['_O']['key']()('multiChartViewModel'),k['_O']['key']()('chartDataViewModel'),k['_O']['key']()('chartConfig'),(N,O,P,Q,R,S)=>{const [T,U]=(0x0,m['D'])({'x':0x0,'y':0x0}),[V,W]=(0x0,m['D'])(![]),X=(0x0,q['fv'])(Q['getChartInfo'](N['id']),N['mainPane']['mainExtent']),[Y,Z]=(0x0,m['D'])(X),[a0,a1]=(0x0,m['D'])({'paneUUID':n['h9'],'idx':0x0}),a2=()=>{const aq=a1['getValue']();return N['paneManager']['panes'][aq['paneUUID']]['yExtentComponents']['find'](ar=>ar['idx']===aq['idx']);},a3=(aq,ar,as)=>{const at=au=>{Y(au);};if(as){const au=()=>at(ar),av=()=>at(aq);O['pushAction']({'type':'y_axis_change_menu_specific','redo':au,'undo':av});}else at(ar);},a4=(aq,ar,as=!![])=>{const at={...Z['getValue']()},au={...Z['getValue']()},av=aq['set'](ar)(au);a3(at,av,as);},a5=()=>{const aq=Z['getValue']()['inverse'];a4(q['c9'],!aq);},a6=aq=>{a4(q['Y4'],aq);},a7=aq=>{a4(q['Cx'],aq);},a8=(aq,ar=!![])=>{if(Z['getValue']()['priceType']==='percent')return;a4(q['U5'],aq,ar),Z['getValue']()['lockPriceToBarRatio']&&a9(![]);},a9=aq=>{aq&&a8(![],![]),a4(q['mJ'],aq);},aa=aq=>{a4(q['gY'],aq);},ab=aq=>{a4(q['bM'],aq);},ac=()=>V(![]),ad=(aq,ar)=>{aq['yAxis']['togglePriceScaleInverse'](ar['data']['inverse']),aq['yAxis']['setYAxisAlign'](ar['data']['align']),aq['yAxis']['setAxisType'](ar['data']['priceType']),aq['scale']['autoScale'](ar['data']['auto']),aq['yAxis']['setLockPriceToBarRatio'](ar['data']['lockPriceToBarRatio']),aq['yAxis']['changeLabelsDescriptionVisibility'](ar['data']['labels']['descriptions']),aq['yAxis']['state']['labels']['descriptions']=ar['data']['labels']['descriptions'],aq['dataSeries']['forEach'](as=>as['config']['labelMode']=ar['data']['labels']['ordinaryLabels']['studies']),aq['yAxis']['changeLabelMode']('studies',ar['data']['labels']['ordinaryLabels']['studies']);},ae=(0x0,d['h'])(N['canvasInputListener']['observeLongTouchStart']()['pipe']((0x0,f['p'])(()=>!N['yAxis']['yAxisScaleHandler']['isDragging']())),N['canvasInputListener']['observeContextMenu']())['pipe']((0x0,j['M'])(()=>{const aq=Object['values'](N['paneManager']['panes'])['flatMap'](as=>as['yExtentComponents'])['find'](as=>as['yAxisHT'](N['canvasInputListener']['currentPoint']['x'],N['canvasInputListener']['currentPoint']['y']));if(!aq)return;a0({'paneUUID':aq['paneUUID'],'idx':aq['idx']});const ar=(0x0,q['t7'])(aq);Y(ar),T(N['canvasInputListener']['currentPointDocument']),V(!![]);})),af=(0x0,p['Fs'])(Z,o['Tj'](aq=>aq['inverse']),(0x0,e['F'])(),(0x0,j['M'])(aq=>{const ar=a2();ar&&ar['yAxis']['togglePriceScaleInverse'](aq);})),ag=(0x0,p['Fs'])(Z,o['Tj'](aq=>aq['align']),(0x0,e['F'])(),(0x0,j['M'])(aq=>{const ar=a2();ar&&ar['yAxis']['setYAxisAlign'](aq),N['yAxis']['axisAlignMovedSubject']['next'](aq);})),ah=(0x0,p['Fs'])(Z,o['Tj'](aq=>aq['priceType']),(0x0,e['F'])(),(0x0,j['M'])(aq=>{const ar=a2();ar&&ar['yAxis']['setAxisType'](aq);})),ai=(0x0,p['Fs'])(Z,o['Tj'](aq=>aq['auto']),(0x0,e['F'])(),(0x0,j['M'])(aq=>{const ar=a2();ar&&ar['scale']['autoScale'](aq);})),aj=(0x0,p['Fs'])(Z,o['Tj'](aq=>aq['lockPriceToBarRatio']),(0x0,e['F'])(),(0x0,j['M'])(aq=>{const ar=a2();ar&&ar['yAxis']['setLockPriceToBarRatio'](aq);})),ak=(0x0,p['Fs'])(Z,o['Tj'](aq=>aq['labels']['descriptions']),(0x0,e['F'])(),(0x0,j['M'])(aq=>{const ar=a2();ar&&(ar['yAxis']['changeLabelsDescriptionVisibility'](aq),ar['yAxis']['state']['labels']['descriptions']=aq);})),al=(0x0,p['Fs'])(Z,o['Tj'](aq=>aq['labels']['ordinaryLabels']['studies']),(0x0,f['p'])(Boolean),(0x0,e['F'])(),(0x0,j['M'])(aq=>{const ar=a2();ar&&(ar?.['dataSeries']['forEach'](as=>as['config']['labelMode']=aq),ar?.['yAxis']['changeLabelMode']('studies',aq));})),am=(0x0,p['Fs'])(P['initialStudiesScalesSet'],(0x0,f['p'])(Boolean),(0x0,h['n'])(()=>Q['state']),o['Tj'](aq=>aq['charts'][Number(N['id'])]['scales']['configs']),(0x0,i['s'])(0x1),(0x0,j['M'])(aq=>{aq['forEach'](ar=>{const as=N['paneManager']['yExtents'],at=as['find'](au=>au['paneUUID']===ar['paneUUID']&&au['idx']===ar['extentIdx']);at&&ad(at,ar);});})),an=(0x0,p['Fs'])(Z,(0x0,g['i'])(0x1),(0x0,j['M'])(aq=>{const ar={...Q['getChartInfo'](N['id'])['scales']},as=ar['configs']['findIndex'](at=>at['extentIdx']===a1['getValue']()['idx']&&at['paneUUID']===a1['getValue']()['paneUUID']);as>-0x1?ar['configs'][as]['data']=aq:ar['configs']['push']({'paneUUID':a1['getValue']()['paneUUID'],'extentIdx':a1['getValue']()['idx'],'data':Z['getValue']()}),Q['updateLocalChartInfo'](N['id'],{'scales':ar});})),ao=(0x0,p['Fs'])(R['historicalCandlesUpdated'],o['Tj'](aq=>aq['length']===0x0),(0x0,e['F'])(),(0x0,j['M'])(aq=>{for(const ar of Object['values'](N['paneManager']['panes'])){ar['yAxis']['setVisible'](!aq&&S['components']['yAxis']['visible']);}})),ap=(0x0,d['h'])(ae,af,ag,ah,ai,aj,ak,al,an,am,ao);return(0x0,l['s'])({'position':U,'isOpened':W,'menuState':Z,'togglePriceScaleInverse':a5,'setYAxisAlign':a6,'setAxisType':a7,'setAutoScale':a8,'setLockPriceToBarRatio':a9,'setDescriptions':aa,'setStudiesLabelMode':ab,'closeMenu':ac},ap);});},0x5124:(a,b,c)=>{c['r'](b),c['d'](b,{'ChartSettingsChartScalesContainer':()=>R,'default':()=>S});var d=c(0x4b31),e=c(0x12e5c),f=c(0xf8d0),g=c(0x8c58),h=c(0x65f5),i=c(0xd114),j=c(0x170c1),k=c(0x135a),l=c(0x660e),m=c(0x14a66),n=c(0x8bd),o=c(0x12fa0),p=c(0xc1d),q=c(0x13c93),r=c(0x8b0b),s=c(0x111c4),t=c(0x1610a),u=c(0x61da);;const v=(0x0,o['Ay'])((0x0,s['A']))['withConfig']({'displayName':'DXChart-ChartSettingsTabScalesStyled','componentId':'DXChart-11jwbs8'})``,w=o['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsTabScalesMainSectionStyled','componentId':'DXChart-1hpd2pq'})`
	width: 100%;
	display: flex;
	flex-direction: column;
	${T=>!T['$showRestoreToDefault']&&(0x0,o['AH'])`
			padding-bottom: var(--spacer-1);
		`}
`,x=o['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsTabScalesDivider','componentId':'DXChart-6599oz'})`
	width: 100%;
	height: 1px;
	margin-top: var(--spacer-1);
	margin-bottom: var(--spacer-1);
	background-color: var(--menu-divider);
`,y=o['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsScalesYAxisSideTitleStyled','componentId':'DXChart-kro4w6'})`
	margin-left: var(--spacer-6);
	padding: var(--spacer-1);
`,z=(0x0,o['Ay'])((0x0,p['G']))['withConfig']({'displayName':'DXChart-ChartSettingsScalesTabItemStyled','componentId':'DXChart-19u6aae'})`
	margin-left: var(--spacer-6);
	${q['H']} {
		margin: 0;
	}
`,A=o['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsTabScalesArrowStyled','componentId':'DXChart-1bqu924'})`
	width: 20px;
	height: 20px;
	color: var(--icon-secondary);
`,B=(0x0,o['Ay'])((0x0,t['gs']))['withConfig']({'displayName':'DXChart-ChartFormFieldsetGroupItemGeneral','componentId':'DXChart-1w6xtuk'})`
	${r['UX']} {
		width: 100%;
		outline: 1px solid transparent;
		background-color: transparent;

		&:focus {
			box-shadow: none;
		}
	}

	${r['mZ']} {
		border: none;
		width: 100%;
		height: 100%;
	}

	${r['GD']} {
		width: 100%;
		height: 100%;
	}

	${T=>T['keyboardModeEnabled']&&'&:focus-within\x20{\x0a\x09\x09border-radius:\x204px;\x0a\x20\x20\x20\x20\x09box-shadow:\x200\x200\x200\x201px\x20var(--button-primary-default-bg);\x0a\x09}'}
`,C=(0x0,o['Ay'])(B)['withConfig']({'displayName':'DXChart-ChartSettingsTabScalesFieldsetGroupItem','componentId':'DXChart-840lyo'})`
	&:hover {
		background-color: var(--menu-item-hover-bg);
		border-radius: var(--spacer-1);
	}
`,D=(0x0,o['Ay'])(B)['withConfig']({'displayName':'DXChart-ChartSettingsTabScalesLinesAndlabelsItemStyled','componentId':'DXChart-122crhy'})`
	margin-bottom: 0;
	display: flex;
	justify-content: space-between;
	position: relative;

	&:hover {
		cursor: pointer;
		background: var(--menu-item-hover-bg);
		border-radius: var(--spacer-1);
	}
	&:focus-within {
		box-shadow: none;
	}

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
`,E=(0x0,o['Ay'])((0x0,u['s']))['withConfig']({'displayName':'DXChart-ChartSettingsFitField','componentId':'DXChart-1nfx08h'})`
	${T=>T['disabledStyles']&&(0x0,o['AH'])`
			color: var(--menu-disabled-text);
			${r['GD']} {
				opacity: 0;
			}
		`}
`;var F=c(0x147f4),G=c(0x3ffe),H=c(0xf3d5);;const I=(0x0,f['memo'])(T=>{const {type:U,active:V,index:W,isDisabled:X,auto:Y,onFitTypeChangeHandler:Z}=T,{keyboardModeEnabled:a0,localization:a1}=(0x0,f['useContext'])(G['e']);return f['createElement'](C,{'keyboardModeEnabled':a0,'key':'item-'+U+'-'+W},f['createElement'](E,{'disabledStyles':!Y,'isDisabled':X,'label':a1['yAxis']['fit'][U]},f['createElement'](H['S'],{'value':V,'testId':l['Y']['chart_settings_checkbox'],'field':U,'onValueChange':Z})));});var J=c(0x16c65),K=c(0xa1ef),L=c(0xa461);;const M=(0x0,f['memo'])(T=>{const {config:U,labelsConfig:V,labelPopoverOpen:W,setLabelandLineOpen:X,setLabelandLineClose:Y,onLinesAndLabelsKeydownHandler:Z,setStudiesLabelMode:a0,onLabelClose:a1,setLabelMode:a2,selectCountDownBarClose:a3,selectDescription:a4}=T,{keyboardModeEnabled:a5,localization:a6}=(0x0,f['useContext'])(G['e']),a7=(0x0,J['sE'])(),a8=(0x0,f['useRef'])(null);return f['createElement'](D,{'tabIndex':0x0,'keyboardModeEnabled':a5,'onMouseEnter':X,'onMouseLeave':Y,'onKeyDown':Z,'ref':a8},f['createElement'](u['s'],{'label':a6['yAxis']['labelsAndLines']},f['createElement'](L['h'],null,a7['yAxisMainPopover']['reverseLabel'])),f['createElement'](A,null,f['createElement'](L['h'],null,a7['yAxisMainPopover']['arrow'])),f['createElement'](K['N'],{'setStudiesLabelMode':a0,'labelsMenuState':U['labels'],'showMainScaleLabels':!![],'isOpened':W,'onClose':a1,'labelsConfig':V,'changeLabelMode':a2,'labelsPopoverRef':a8,'selectCountDownBarClose':a3,'selectDescription':a4,'yAxisDict':a6['yAxis'],'position':'right','align':'start'}));});;const N=(0x0,f['memo'])(T=>{const {localization:U,configVMState:V,config:W,onRestoreDefaultRequest:X,toggleAutoScale:Y,changeFitType:Z,setAxisAlign:a0,setAxisType:a1,togglePriceScaleInverse:a2,setLockPriceToBarRatio:a3,labelsConfig:a4,setLabelMode:a5,selectCountDownBarClose:a6,selectDescription:a7,setStudiesLabelMode:a8,showRestoreToDefault:a9}=T,{auto:aa,lockPriceToBarRatio:ab,inverse:ac}=W,ad=(0x0,f['useRef'])(null),[ae,af]=(0x0,f['useState'])(![]),ag={'regular':W['priceType']==='regular','percent':W['priceType']==='percent','logarithmic':W['priceType']==='logarithmic'},ah=(0x0,f['useMemo'])(()=>[{'name':U['yAxis']['axisType']['regular'],'type':'regular','ariaLabel':U['yAxis']['buttons']['a11y_regular']},{'name':U['yAxis']['axisType']['percent'],'type':'percent','ariaLabel':U['yAxis']['buttons']['a11y_percent']},{'name':U['yAxis']['axisType']['logarithmic'],'type':'logarithmic','ariaLabel':U['yAxis']['buttons']['a11y_logarithmic']}],[U]),ai=(0x0,f['useMemo'])(()=>[{'name':U['yAxis']['axisAlign']['settingsLeft'],'type':'left','ariaLabel':U['yAxis']['axisAlign']['left']},{'name':U['yAxis']['axisAlign']['settingsRight'],'type':'right','ariaLabel':U['yAxis']['axisAlign']['right']}],[U]),aj=(0x0,f['useMemo'])(()=>[{'type':'studies','active':V['chartReact']['scale']['fit']['studies']},{'type':'positions','active':V['chartReact']['scale']['fit']['positions']},{'type':'orders','active':V['chartReact']['scale']['fit']['orders']}],[V['chartReact']['scale']['fit']['orders'],V['chartReact']['scale']['fit']['positions'],V['chartReact']['scale']['fit']['studies']]),ak=(0x0,f['useCallback'])((at=![])=>Y(at),[Y]),al=(0x0,f['useCallback'])((at=![],au)=>{Y(!![]),au&&Z(au,at);},[Z,Y]),am=(0x0,f['useCallback'])(at=>{a1(at),at!=='regular'&&a3(![]);},[a1,a3]),an=(0x0,f['useCallback'])(at=>a0(at),[a0]),ao=(0x0,f['useCallback'])(()=>af(!![]),[]),ap=(0x0,f['useCallback'])(()=>af(![]),[]),{isMobile:aq}=(0x0,f['useContext'])(m['Ip']),ar=(0x0,k['U'])(()=>ao(),[]),as=(0x0,f['useCallback'])(()=>a3(!W['lockPriceToBarRatio']),[W['lockPriceToBarRatio'],a3]);return f['createElement'](n['au'],{'data-test-id':l['Y']['chart_settings_tab_scales_content']},f['createElement'](w,{'$showRestoreToDefault':a9,'ref':ad},f['createElement'](F['z'],{'disabled':ag['percent'],'label':U['yAxis']['auto'],'value':aa,'onValueChange':ak}),aj['map'](({type:at,active:au},av)=>f['createElement'](I,{'key':'item-'+at+'-'+av,'isDisabled':ag['percent'],'type':at,'active':au,'index':av,'auto':aa,'onFitTypeChangeHandler':al})),f['createElement'](x,null),f['createElement'](F['z'],{'label':U['yAxis']['scale']['inverse'],'value':ac,'onValueChange':a2}),f['createElement'](F['z'],{'disabled':W['priceType']!=='regular','label':U['yAxis']['scale']['lock'],'value':ab,'onValueChange':as}),f['createElement'](x,null),f['createElement'](z,{'buttons':ah,'selected':W['priceType'],'onSelect':am,'ariaLabel':U['yAxis']['buttons']['a11y_scaleType']}),f['createElement'](x,null),f['createElement'](y,null,U['yAxis']['axisAlign']['title']),f['createElement'](z,{'buttons':ai,'selected':W['align'],'onSelect':an,'ariaLabel':U['yAxis']['buttons']['a11y_sideAlign']}),f['createElement'](x,null),!aq&&f['createElement'](M,{'config':W,'labelsConfig':a4,'labelPopoverOpen':ae,'setLabelandLineOpen':ao,'setLabelandLineClose':ap,'onLinesAndLabelsKeydownHandler':ar,'setStudiesLabelMode':a8,'onLabelClose':ap,'setLabelMode':a5,'selectCountDownBarClose':a6,'selectDescription':a7}),a9&&f['createElement'](n['ov'],{'onClick':X},U['settingsPopup']['resetToDefaultsBtn'])));}),O=null&&N;var P=c(0x2cc3);;const Q={'isMainCandlesMenu':!![],'auto':!![],'inverse':![],'lockPriceToBarRatio':![],'align':'right','priceType':'regular','labels':{'descriptions':![],'ordinaryLabels':{'studies':'label'}}},R=g['_O']['combine'](g['_O']['key']()('yAxisConfiguratorViewModel'),P['M'],g['_O']['key']()('chartConfiguratorViewModel'),g['_O']['key']()('localization'),g['_O']['key']()('chartConfig'),(T,U,V,W,X)=>(0x0,h['s'])('ChartSettingsChartTypeScales',Y=>{const Z=(0x0,i['N'])(V['config']),a0=(0x0,i['N'])(T['mainYAxisState']),a1=(0x0,i['N'])(T['labelsConfig']),{defaultConfig:a2}=Y,a3=(0x0,i['k'])(V['state'],['settings']),a4=(0x0,f['useMemo'])(()=>!(0x0,e['bD'])(Q,a0)||!(0x0,e['bD'])(a2,(0x0,d['h1'])((0x0,e['Ql'])(a2),(0x0,d['h1'])((0x0,e['Ql'])(a3),(0x0,e['Ql'])(a1)),{'overrideExisting':!![],'addIfMissing':![]})),[a2,a0,a3,a1]),a5=(0x0,f['useCallback'])(()=>{const a6=(0x0,j['QH'])(a2,X['components']['yAxis']['labels']);T['setYAxisLabelsSettings'](a1,a6),T['setMainYAxisState'](Q),V['onRestoreDefaultConfigTab'](a2);},[a1,a2]);return(0x0,f['createElement'])(N,{'configVMState':Z,'config':a0,'setStudiesLabelMode':T['setStudiesLabelMode'],'labelsConfig':a1,'localization':W,'showRestoreToDefault':a4,'changeFitType':T['setPriceAxisFitType'],'setLabelMode':T['changeLabelMode'],'selectCountDownBarClose':T['setCountDownBarClose'],'toggleAutoScale':T['setAutoScale'],'togglePriceScaleInverse':T['togglePriceScaleInverse'],'setLockPriceToBarRatio':T['setLockPriceToBarRatio'],'setAxisAlign':T['setYAxisAlign'],'setAxisType':T['setAxisType'],'selectDescription':T['setDescription'],'onRestoreDefaultRequest':a5});})),S=R;},0x6620:(a,b,c)=>{c['d'](b,{'BF':()=>r,'T5':()=>s,'v3':()=>w,'RQ':()=>t,'M6':()=>u,'at':()=>y,'PY':()=>A,'xK':()=>q,'HQ':()=>p,'k$':()=>v,'Gf':()=>x});var d=c(0x8b0b),e=c(0x12fa0),f=c(0x1610a),g=c(0xfa78),h=c(0xc514),i=c(0x6333),j=c(0x10fc5),k=c(0x2668);;const l=(0x0,e['Ay'])((0x0,k['r']))['withConfig']({'displayName':'DXChart-DropdownMenuSecondaryStyled','componentId':'DXChart-1gffxgq'})`
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
`;},0xa1ef:(a,b,c)=>{c['d'](b,{'N':()=>t});var d=c(0xf8d0),e=c(0x12fa0),f=c(0x1690d),g=c(0x7cbe);;const h=(0x0,e['Ay'])((0x0,g['W']))['withConfig']({'displayName':'DXChart-YAxisLabelsMenuStyled','componentId':'DXChart-z2hwoh'})``,i=e['Ay']['div']['withConfig']({'displayName':'DXChart-YAxisLinesPopoverMenuContainerStyled','componentId':'DXChart-182mp9e'})`
	box-sizing: border-box;
	width: 205px;
	height: auto;
	display: flex;
	flex-direction: column;
	align-items: center;
	user-select: none;
`,j=(0x0,e['Ay'])((0x0,f['MI']))['withConfig']({'displayName':'DXChart-YAxisLinesPopoverDivider','componentId':'DXChart-jsdb5w'})`
	width: 100%;
`;var k=c(0x16c65),l=c(0xa461),m=c(0x9b04),n=c(0xa975),o=c(0x3ffe),p=c(0xb2e3),q=c(0x16fba);;const r=['none','label','line','line-label'],s=u=>{const v=(r['indexOf'](u)+0x1)%r['length'];return r[v];},t=d['memo'](A=>{const {onClose:B,isOpened:C,showMainScaleLabels:D,labelsConfig:{labels:E,countDownToBarClose:F},labelsMenuState:G,changeLabelMode:H,selectDescription:I,setStudiesLabelMode:J,selectCountDownBarClose:K,yAxisDict:L,position:M,align:N,labelsPopoverRef:O,selectorRef:selectorRef=O}=A,P=(0x0,d['useRef'])(null),Q=(0x0,d['useCallback'])(Z=>{const a0=Z,a1=a0==='studies'?G['ordinaryLabels']['studies']:E[a0];if(Z&&a1){const a2=s(a1);a0==='studies'?J(a2):H(a0,a2);}},[H,E,G['ordinaryLabels']['studies'],J]),R=(0x0,d['useCallback'])(()=>{K(!F),B();},[F,K,B]),S=(0x0,d['useCallback'])(()=>{I(!G['descriptions']),B();},[I,G['descriptions'],B]),{keyboardModeEnabled:T}=(0x0,d['useContext'])(o['e']),U=(0x0,k['sE'])(),V=(0x0,d['useMemo'])(()=>D?{...E,'studies':G['ordinaryLabels']['studies']}:{'studies':G['ordinaryLabels']['studies']},[G['ordinaryLabels'],E,D]),W={'none':d['createElement']('span',null),'line-label':d['createElement'](l['h'],null,U['yAxisLabelsPopover']['lineLabel']),'label':d['createElement'](l['h'],null,U['yAxisLabelsPopover']['label']),'line':d['createElement'](l['h'],null,U['yAxisLabelsPopover']['line'])},X=(0x0,d['useCallback'])(Z=>{P['current']=Z;},[]);(0x0,m['f'])({'anchorRef':selectorRef,'popRef':P});const Y=(0x0,n['r'])(P);return d['createElement'](h,{'className':q['X']['menu']['yAxisLabels'],'onTabPress':Y,'keyboardMode':T,'opened':C,'onRequestClose':B,'selectorRef':selectorRef,'anchorRef':O,'align':N,'style':{'top':'4px'},'position':M},d['createElement'](i,{'ref':X},d['createElement'](p['cN'],{'onItemSelect':Q},Object['entries'](V)['map'](([Z,a0],a1)=>a0?d['createElement'](f['Vi'],{'key':'item-'+Z+'-'+a1,'value':Z},d['createElement'](f['EH'],null,d['createElement'](f['V'],null,W[a0]),d['createElement'](f['jF'],null,L['labels'][Z]))):null)),d['createElement'](j,null),d['createElement'](p['cN'],{'onItemSelect':S},d['createElement'](f['Vi'],{'value':'descriptions'},d['createElement'](f['EH'],null,d['createElement'](f['V'],null,G['descriptions']&&d['createElement'](l['h'],null,U['yAxisLabelsPopover']['checkboxTick'])),d['createElement'](f['jF'],null,L['descriptions'])))),D&&d['createElement'](p['cN'],{'onItemSelect':R},d['createElement'](f['Vi'],{'value':'countDownBarClose'},d['createElement'](f['EH'],null,d['createElement'](f['V'],null,F&&d['createElement'](l['h'],null,U['yAxisLabelsPopover']['checkboxTick'])),d['createElement'](f['jF'],null,L['countDownToBarClose']))))));});},0xb2e3:(a,b,c)=>{c['d'](b,{'DT':()=>m,'Jz':()=>i,'Op':()=>k,'VG':()=>j,'cN':()=>h,'jV':()=>n});var d=c(0x12fa0),e=c(0x143fd),f=c(0x145),g=c(0x6620);const h=(0x0,d['Ay'])((0x0,e['W']))['withConfig']({'displayName':'DXChart-RightClickPopoverMenuStyled','componentId':'DXChart-72v1bm'})`
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
`;},0x13c93:(a,b,c)=>{c['d'](b,{'H':()=>g,'l':()=>f});var d=c(0x12fa0),e=c(0xa277);const f=d['Ay']['div']['withConfig']({'displayName':'DXChart-ButtonsRadioGroupStyled','componentId':'DXChart-c1qbei'})`
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