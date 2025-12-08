/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x246],{0x14296:(a,b,c)=>{c['r'](b),c['d'](b,{'DrawingGroupsDropdown':()=>J,'default':()=>L});var d=c(0xf8d0),e=c(0x7a5f),f=c(0x15f29),g=c(0xc138),h=c(0x135a),i=c(0x9b04),j=c(0x660e),k=c(0x3ffe),l=c(0x16c65),m=c(0x12fa0),n=c(0xfa78),o=c(0xc514);;const p=(0x0,m['Ay'])((0x0,n['x']))['withConfig']({'displayName':'DXChart-DrawingGroupsAnchorStyled','componentId':'DXChart-7qxgta'})`
	box-sizing: border-box;
	max-width: ${M=>M['anchorMaxWidth']};
	min-width: ${M=>M['anchorMinWidth']};
	height: 24px;
	border-radius: 4px;
	padding: var(--spacer-1);
	background-color: var(--chart-bg);
	color: var(--chart-value-default-text);
	font-size: var(--font-size-m);
	font-family: var(--font-main-semibold);

	${o['XQ']} {
		display: flex;
	}

	${o['TO']} {
		text-align: start;
		flex-grow: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		width: ${M=>M['textWidth']};
	}

	${o['P3']} {
		span {
			margin-right: var(--spacer-05);
		}
	}

	&:hover {
		background-color: var(--menu-bg);
	}
`;var q=c(0x14a66);;const r=(0x0,d['memo'])(M=>{const {onClick:N,buttonRef:O,...P}=M,Q=(0x0,l['sE'])(),{isMobile:R}=(0x0,d['useContext'])(q['Ip']),{localization:S}=(0x0,d['useContext'])(k['e']),T=s(R);return d['createElement'](p,{...P,'ariaLabel':S['drawingGroups']['a11y_drawingGroupsAnchor'],'testId':j['Y']['drawing_groups_anchor'],'onClick':N,'buttonRef':O,'caretIcon':Q['selectBox']['arrow'],'anchorMinWidth':T['anchorMinWidth'],'anchorMaxWidth':T['anchorMaxWidth'],'textWidth':T['textWidth']});}),s=M=>({'anchorMinWidth':M?'40px':'100px','anchorMaxWidth':M?'40px':'160px','textWidth':M?'20px':'auto'});var t=c(0x12d14),u=c(0x26ce),v=c(0x2668),w=c(0x145),x=c(0x111c4),y=c(0x4fb3);;const z=(0x0,m['Ay'])((0x0,x['A']))['withConfig']({'displayName':'DXChart-DrawingGroupsPopoverStyled','componentId':'DXChart-1uid7y6'})`
	${y['Kc']} {
		padding: var(--spacer-1);
		width: 170px;
	}
`,A=(0x0,m['Ay'])((0x0,v['r']))['withConfig']({'displayName':'DXChart-DrawingGroupsDropdownMenuStyled','componentId':'DXChart-bffqhm'})`
	padding: 0;
`,B=(0x0,m['Ay'])((0x0,w['D']))['withConfig']({'displayName':'DXChart-DrawingGroupsDropdownMenuItemStyled','componentId':'DXChart-145n7mo'})`
	height: 24px;
	display: flex;
	align-items: center;

	&:focus-visible {
		border-radius: 4px;
	}
`,C=m['Ay']['span']['withConfig']({'displayName':'DXChart-DrawingGroupsMenuItemText','componentId':'DXChart-yqrm3k'})`
	max-width: 110px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`,D=(0x0,m['Ay'])((0x0,u['l']))['withConfig']({'displayName':'DXChart-DrawingGroupMIDeleteButton','componentId':'DXChart-c4av0l'})`
	position: absolute;
	right: 12px;
	margin-left: 7px;
	transform: translateX(var(--spacer-3));

	&:hover svg path,
	&:focus svg path {
		fill: var(--chart-bear-default);
	}
`,E=(0x0,m['Ay'])((0x0,u['l']))['withConfig']({'displayName':'DXChart-DrawingGroupMIEditButton','componentId':'DXChart-ddclu0'})`
	position: absolute;
	inset-inline-end: 32px;
	margin-inline-start: auto;
	transform: translateX(var(--spacer-3));
`;var F=c(0x72d7),G=c(0xa461),H=c(0xe3e9),I=c(0x3cf4);;const J=(0x0,d['memo'])(M=>{const {groups:N,selectedGroup:O,selectGroup:P,addGroup:Q,deleteGroup:R,renameGroup:S}=M,[T,U]=(0x0,d['useState'])(![]),[V,W]=(0x0,d['useState'])(f['dv']),[X,Y]=(0x0,d['useState'])(![]),{keyboardModeEnabled:Z,localization:a0}=(0x0,d['useContext'])(k['e']),[a1,a2]=(0x0,d['useState'])(f['dv']),a3=(0x0,d['useRef'])(null),a4=(0x0,d['useRef'])(null);(0x0,d['useEffect'])(()=>()=>{Y(![]),W(f['dv']);},[T]);const a5=(0x0,d['useCallback'])(()=>U(!T),[T,U]),a6=(0x0,d['useCallback'])(()=>U(![]),[U]),a7=(0x0,d['useCallback'])(ac=>{P(ac),a6();},[P,a6]),a8=(0x0,d['useCallback'])(ac=>{Q(ac),a6();},[Q,a6]);(0x0,i['f'])({'anchorRef':a3,'popRef':a4,'focusSelector':'*[data-active=\x22true\x22]'});const a9=(0x0,h['U'])(()=>a5(),[a5]),aa=(0x0,d['useCallback'])(ac=>{Y(ac),W(f['dv']);},[]),ab=(0x0,d['useCallback'])(ac=>{Y(![]),W(ac);},[]);return(0x0,l['VC'])(['Footer','DrawingGroupsDropdown'],M)??d['createElement'](d['Fragment'],null,d['createElement'](r,{'buttonRef':a3,'onKeyDown':a9,'onClick':a5,'testId':j['Y']['drawing_groups_anchor'],'value':O['id'],'valueText':O['name']}),d['createElement'](z,{'anchorRef':a3,'align':'end','position':'top','opened':T,'onRequestClose':a6,'keyboardMode':Z},d['createElement'](A,{'ariaLabel':a0['drawingGroups']['a11y_drawingGroupsMenu'],'ref':a4},(0x0,g['Fs'])(N,e['Tj'](ac=>{const ad=ac['id']===O['id'],ae=f['AU'](()=>![],ag=>ac['id']===ag)(V),af=f['AU'](()=>![],ag=>ac['id']===ag)(a1);return d['createElement'](K,{'key':ac['id'],'group':ac,'active':ad,'isHovered':af,'editable':ae,'selectGroup':a7,'deleteGroup':R,'renameGroup':S,'setMouseOverGroupId':a2,'setEditableGroup':ab});})),d['createElement'](H['Q'],{'testIds':{'input':j['Y']['drawing_groups_input'],'inactiveText':j['Y']['drawing_groups_placeholder'],'inputError':j['Y']['drawing_groups_input_error'],'inputWrapper':j['Y']['drawing_groups_input_wrapper'],'confirmButton':j['Y']['drawing_groups_input_button']},'key':'drawing_groups_input','inactiveText':a0['drawingGroups']['addNewGroup'],'placeholder':a0['drawingGroups']['addNewGroupPlaceholder'],'keyboardModeEnabled':Z,'onEnter':a8,'isActive':X,'onActiveChange':aa}))));}),K=(0x0,d['memo'])(M=>{const {group:N,active:O,editable:P,isHovered:Q,selectGroup:R,deleteGroup:S,renameGroup:T,setEditableGroup:U,setMouseOverGroupId:V}=M,{keyboardModeEnabled:W,localization:X}=(0x0,d['useContext'])(k['e']),Y=(0x0,l['sE'])(),Z=(0x0,d['useCallback'])(()=>R(N['id']),[R,N['id']]),a0=(0x0,d['useCallback'])(a9=>{a9['stopPropagation'](),V(f['dv']),S(N['id']);},[S,N['id'],V]),a1=(0x0,d['useCallback'])(a9=>{T(N['id'],a9),U(f['dv']);},[T,U,N['id']]),a2=(0x0,d['useCallback'])(a9=>{a9['stopPropagation'](),V(f['dv']),U((0x0,f['zN'])(N['id']));},[V,U,N['id']]),a3=(0x0,d['useCallback'])(()=>U(f['dv']),[U]),a4=(0x0,d['useMemo'])(()=>(0x0,t['e'])(['Enter',Z]),[Z]),a5=(0x0,d['useCallback'])(()=>V((0x0,f['zN'])(N['id'])),[N['id'],V]),a6=(0x0,d['useCallback'])(()=>V(f['dv']),[V]),a7=(0x0,d['useCallback'])(()=>W&&a5(),[W,a5]),a8=(0x0,d['useCallback'])(()=>W&&a6(),[W,a6]);return P?d['createElement'](H['Q'],{'isActive':P,'defaultValue':N['name'],'key':N['name']+'_'+N['id'],'keyboardModeEnabled':W,'onEnter':a1,'onFocusOut':a3}):d['createElement'](B,{'key':N['name']+'_'+N['id'],'onSelect':Z,'keyboardModeEnabled':W,'onFocus':a7,'onBlur':a8,'onMouseEnter':a5,'onMouseLeave':a6,'value':N['id'],'isActive':O,'onKeyDown':a4},d['createElement'](C,null,N['name']),N['id']!==I['Y']&&d['createElement'](d['Fragment'],null,d['createElement'](F['CH'],{'visible':Q,'aria-label':X['drawingGroups']['a11y_editGroup'],'aria-hidden':!![],'tabIndex':-0x1,'icon':d['createElement'](G['h'],null,Y['drawingGroups']['edit']),'onClick':a2}),d['createElement'](F['hs'],{'visible':Q,'aria-label':X['drawingGroups']['a11y_deleteGroup'],'aria-hidden':!![],'tabIndex':-0x1,'icon':d['createElement'](G['h'],null,Y['drawingGroups']['delete']),'onClick':a0})));}),L=J;}}]);