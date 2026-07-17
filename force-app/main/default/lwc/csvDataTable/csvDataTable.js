import { LightningElement, api } from 'lwc';

export default class CsvDataTable extends LightningElement {
    @api data = [];
    @api columns = [];
    @api draftValues = [];
    @api keyField = 'id';

    suppressBottomBar = true;
    hideCheckboxColumn = true;

    handleCellChange(event) {
        
        this.dispatchEvent(
            new CustomEvent('cellchange', {
                detail: event.detail
            })
        );
    }
}