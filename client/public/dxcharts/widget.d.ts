/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
import { ChartReactWidgetProps } from './widget.config';
export declare const createWidget: (container: HTMLElement, props: ChartReactWidgetProps) => Promise<{
    destroy: () => void;
}>;
export declare const destroyGlobal: () => void;
