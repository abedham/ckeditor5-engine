/**
 * @license Copyright (c) 2003-2019, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

import UpcastDispatcher from '../../src/conversion/upcastdispatcher';
import ViewContainerElement from '../../src/view/containerelement';
import ViewElement from '../../src/view/element';
import ViewDocumentFragment from '../../src/view/documentfragment';
import ViewText from '../../src/view/text';

import Model from '../../src/model/model';
import ModelText from '../../src/model/text';
import ModelTextProxy from '../../src/model/textproxy';
import ModelElement from '../../src/model/element';
import ModelDocumentFragment from '../../src/model/documentfragment';
import ModelPosition from '../../src/model/position';
import ModelRange from '../../src/model/range';
import ModelWriter from '../../src/model/writer';

import first from '@ckeditor/ckeditor5-utils/src/first';
import CKEditorError from '@ckeditor/ckeditor5-utils/src/ckeditorerror';

describe( 'UpcastDispatcher', () => {
	let model;

	beforeEach( () => {
		model = new Model();
	} );

	describe( 'constructor()', () => {
		it( 'should create UpcastDispatcher with passed api', () => {
			const apiObj = {};
			const dispatcher = new UpcastDispatcher( { apiObj } );

			expect( dispatcher.conversionApi.apiObj ).to.equal( apiObj );
			expect( dispatcher.conversionApi ).to.have.property( 'convertItem' ).that.is.instanceof( Function );
			expect( dispatcher.conversionApi ).to.have.property( 'convertChildren' ).that.is.instanceof( Function );
			expect( dispatcher.conversionApi ).to.have.property( 'splitToAllowedParent' ).that.is.instanceof( Function );
		} );

		it( 'should not crash if no additional api is passed', () => {
			const dispatcher = new UpcastDispatcher();

			expect( dispatcher.conversionApi ).to.have.property( 'convertItem' ).that.is.instanceof( Function );
			expect( dispatcher.conversionApi ).to.have.property( 'convertChildren' ).that.is.instanceof( Function );
			expect( dispatcher.conversionApi ).to.have.property( 'splitToAllowedParent' ).that.is.instanceof( Function );
		} );
	} );

	describe( 'convert()', () => {
		let dispatcher;

		beforeEach( () => {
			dispatcher = new UpcastDispatcher( { schema: model.schema } );
		} );

		it( 'should create api for a conversion process', () => {
			const viewElement = new ViewContainerElement( 'p', null, new ViewText( 'foobar' ) );

			// To be sure that both converters was called.
			const spy = sinon.spy();

			// To check that the same writer instance.
			let writer;

			// Conversion process properties should be undefined/empty before conversion.
			expect( dispatcher.conversionApi.writer ).to.not.ok;
			expect( dispatcher.conversionApi.store ).to.not.ok;

			dispatcher.on( 'element', ( evt, data, conversionApi ) => {
				// Check conversion api params.
				expect( conversionApi.writer ).to.instanceof( ModelWriter );
				expect( conversionApi.store ).to.deep.equal( {} );

				// Remember writer to check in next converter that is exactly the same instance (the same undo step).
				writer = conversionApi.writer;

				// Add some data to conversion storage to verify them in next converter.
				conversionApi.store.foo = 'bar';

				// Convert children - this will call second converter.
				conversionApi.convertChildren( data.viewItem, data.modelCursor );

				spy();
			} );

			dispatcher.on( 'text', ( evt, data, conversionApi ) => {
				// The same writer is used in converters during one conversion.
				expect( conversionApi.writer ).to.equal( writer );

				// Data set by previous converter are remembered.
				expect( conversionApi.store ).to.deep.equal( { foo: 'bar' } );

				spy();
			} );

			model.change( writer => dispatcher.convert( viewElement, writer ) );

			// To be sure that both converters was called.
			sinon.assert.calledTwice( spy );

			// Conversion process properties should be cleared after conversion.
			expect( dispatcher.conversionApi.writer ).to.not.ok;
			expect( dispatcher.conversionApi.store ).to.not.ok;
		} );

		it( 'should fire viewCleanup event on converted view part', () => {
			sinon.spy( dispatcher, 'fire' );

			const viewP = new ViewContainerElement( 'p' );
			model.change( writer => dispatcher.convert( viewP, writer ) );

			expect( dispatcher.fire.calledWith( 'viewCleanup', viewP ) ).to.be.true;
		} );

		it( 'should fire proper events', () => {
			const viewText = new ViewText( 'foobar' );
			const viewElement = new ViewContainerElement( 'p', null, viewText );
			const viewFragment = new ViewDocumentFragment( viewElement );

			sinon.spy( dispatcher, 'fire' );

			model.change( writer => {
				dispatcher.convert( viewText, writer );
				dispatcher.convert( viewElement, writer );
				dispatcher.convert( viewFragment, writer );
			} );

			expect( dispatcher.fire.calledWith( 'text' ) ).to.be.true;
			expect( dispatcher.fire.calledWith( 'element:p' ) ).to.be.true;
			expect( dispatcher.fire.calledWith( 'documentFragment' ) ).to.be.true;
		} );

		it( 'should convert ViewText', () => {
			const spy = sinon.spy();
			const viewText = new ViewText( 'foobar' );

			dispatcher.on( 'text', ( evt, data, conversionApi ) => {
				// Check if this method has been fired.
				spy();

				// Check correctness of passed parameters.
				expect( evt.name ).to.equal( 'text' );
				expect( data.viewItem ).to.equal( viewText );
				expect( data.modelCursor ).to.instanceof( ModelPosition );

				// Check whether consumable has appropriate value to consume.
				expect( conversionApi.consumable.consume( data.viewItem ) ).to.be.true;

				// Check whether conversionApi of `dispatcher` has been passed.
				expect( conversionApi ).to.equal( dispatcher.conversionApi );

				const text = conversionApi.writer.createText( data.viewItem.data );
				conversionApi.writer.insert( text, data.modelCursor );

				// Set conversion result to `modelRange` property of `data`.
				// Later we will check if it was returned by `convert` method.
				data.modelRange = ModelRange._createOn( text );
			} );

			const conversionResult = model.change( writer => dispatcher.convert( viewText, writer ) );

			// Check conversion result.
			// Result should be wrapped in document fragment.
			expect( conversionResult ).to.be.instanceof( ModelDocumentFragment );
			expect( conversionResult.getChild( 0 ).data ).to.equal( 'foobar' );
			expect( spy.calledOnce ).to.be.true;
		} );

		it( 'should convert ViewContainerElement', () => {
			const spy = sinon.spy();
			const viewElement = new ViewContainerElement( 'p', { attrKey: 'attrValue' } );

			dispatcher.on( 'element', ( evt, data, conversionApi ) => {
				// Check if this method has been fired.
				spy();

				// Check correctness of passed parameters.
				expect( evt.name ).to.equal( 'element:p' );
				expect( data.viewItem ).to.equal( viewElement );
				expect( data.modelCursor ).to.instanceof( ModelPosition );

				// Check whether consumable has appropriate value to consume.
				expect( conversionApi.consumable.consume( data.viewItem, { name: true } ) ).to.be.true;
				expect( conversionApi.consumable.consume( data.viewItem, { attribute: 'attrKey' } ) ).to.be.true;

				// Check whether conversionApi of `dispatcher` has been passed.
				expect( conversionApi ).to.equal( dispatcher.conversionApi );

				const paragraph = conversionApi.writer.createElement( 'paragraph' );
				conversionApi.writer.insert( paragraph, data.modelCursor );

				// Set conversion result to `modelRange` property of `data`.
				// Later we will check if it was returned by `convert` method.
				data.modelRange = ModelRange._createOn( paragraph );
			} );

			// Use `additionalData` parameter to check if it was passed to the event.
			const conversionResult = model.change( writer => dispatcher.convert( viewElement, writer ) );

			// Check conversion result.
			// Result should be wrapped in document fragment.
			expect( conversionResult ).to.be.instanceof( ModelDocumentFragment );
			expect( conversionResult.getChild( 0 ).name ).to.equal( 'paragraph' );
			expect( spy.calledOnce ).to.be.true;
		} );

		it( 'should convert ViewDocumentFragment', () => {
			const spy = sinon.spy();
			const viewFragment = new ViewDocumentFragment();

			dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
				// Check if this method has been fired.
				spy();

				// Check correctness of passed parameters.
				expect( evt.name ).to.equal( 'documentFragment' );
				expect( data.viewItem ).to.equal( viewFragment );
				expect( data.modelCursor ).to.instanceof( ModelPosition );

				// Check whether consumable has appropriate value to consume.
				expect( conversionApi.consumable.consume( data.viewItem ) ).to.be.true;

				// Check whether conversionApi of `dispatcher` has been passed.
				expect( conversionApi ).to.equal( dispatcher.conversionApi );

				const text = conversionApi.writer.createText( 'foo' );
				conversionApi.writer.insert( text, data.modelCursor );

				// Set conversion result to `modelRange` property of `data`.
				// Later we will check if it was returned by `convert` method.
				data.modelRange = ModelRange._createOn( text );
			} );

			const conversionResult = model.change( writer => dispatcher.convert( viewFragment, writer ) );

			// Check conversion result.
			expect( conversionResult ).to.be.instanceof( ModelDocumentFragment );
			expect( conversionResult.getChild( 0 ).data ).to.equal( 'foo' );
			expect( spy.calledOnce ).to.be.true;
		} );

		it( 'should remove empty elements that was created as a result of split', () => {
			const viewElement = new ViewElement( 'div', null, [
				new ViewElement( 'p', null, [
					new ViewElement( 'img' )
				] )
			] );

			model.schema.register( 'div', { allowIn: '$root' } );
			model.schema.register( 'p', { allowIn: 'div' } );
			model.schema.register( 'image', { allowIn: '$root' } );

			dispatcher.on( 'element:img', ( evt, data, conversionApi ) => {
				const writer = conversionApi.writer;

				const modelElement = writer.createElement( 'image' );
				const splitResult = conversionApi.splitToAllowedParent( modelElement, data.modelCursor );
				writer.insert( modelElement, splitResult.position );

				data.modelRange = writer.createRangeOn( modelElement );
				data.modelCursor = writer.createPositionAt( splitResult.cursorParent, 0 );

				// Prevent below converter to fire.
				evt.stop();
			}, { priority: 'high' } );

			dispatcher.on( 'element', ( evt, data, conversionApi ) => {
				const writer = conversionApi.writer;

				const modelElement = writer.createElement( data.viewItem.name );
				writer.insert( modelElement, data.modelCursor );

				const result = conversionApi.convertChildren( data.viewItem, writer.createPositionAt( modelElement, 0 ) );

				data.modelRange = writer.createRange(
					writer.createPositionBefore( modelElement ),
					conversionApi.writer.createPositionAfter( result.modelCursor.parent )
				);
				data.modelCursor = data.modelRange.end;
			} );

			const result = model.change( writer => dispatcher.convert( viewElement, writer ) );

			// After splits `div` and `p` are empty so they should be removed.
			expect( result.childCount ).to.equal( 1 );
			expect( result.getChild( 0 ).name ).to.equal( 'image' );
		} );

		it( 'should extract temporary markers elements from converter element and create static markers list', () => {
			const viewFragment = new ViewDocumentFragment();

			dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
				// Create model fragment.
				const fragment = new ModelDocumentFragment( [
					new ModelText( 'fo' ),
					new ModelElement( '$marker', { 'data-name': 'marker1' } ),
					new ModelText( 'o' ),
					new ModelElement( '$marker', { 'data-name': 'marker2' } ),
					new ModelText( 'b' ),
					new ModelElement( '$marker', { 'data-name': 'marker1' } ),
					new ModelText( 'ar' ),
				] );

				// Insert to conversion tree.
				conversionApi.writer.insert( fragment, data.modelCursor );

				// Create range on this fragment as a conversion result.
				data.modelRange = ModelRange._createIn( data.modelCursor.parent );
			} );

			const conversionResult = model.change( writer => dispatcher.convert( viewFragment, writer ) );

			expect( conversionResult.markers.size ).to.equal( 2 );

			const marker1 = conversionResult.markers.get( 'marker1' );
			const marker2 = conversionResult.markers.get( 'marker2' );

			expect( marker1.start.path ).to.deep.equal( [ 2 ] );
			expect( marker1.end.path ).to.deep.equal( [ 4 ] );
			expect( marker2.start.path ).to.deep.equal( marker2.end.path ).to.deep.equal( [ 3 ] );
		} );

		it( 'should convert according to given context', () => {
			dispatcher = new UpcastDispatcher( { schema: model.schema } );

			const spy = sinon.spy();
			const viewElement = new ViewContainerElement( 'third' );
			let checkChildResult;

			model.schema.register( 'first', {
				allowIn: '$root'
			} );
			model.schema.register( 'second', {
				allowIn: 'first'
			} );
			model.schema.register( 'third', {
				allowIn: 'second',
				disallowIn: 'first'
			} );

			dispatcher.on( 'element:third', ( evt, data, conversionApi ) => {
				spy();
				checkChildResult = conversionApi.schema.checkChild( data.modelCursor, 'third' );
			} );

			// Default context $root.
			model.change( writer => dispatcher.convert( viewElement, writer ) );
			sinon.assert.calledOnce( spy );
			expect( checkChildResult ).to.false;

			// SchemaDefinition as context.
			model.change( writer => dispatcher.convert( viewElement, writer, [ 'first' ] ) );
			sinon.assert.calledTwice( spy );
			expect( checkChildResult ).to.false;

			// Position as context.
			const fragment = new ModelDocumentFragment( [
				new ModelElement( 'first', { foo: 'bar' }, [
					new ModelElement( 'second', null )
				] )
			] );

			model.change( writer => dispatcher.convert( viewElement, writer, new ModelPosition( fragment, [ 0, 0, 0 ] ) ) );
			sinon.assert.calledThrice( spy );
			expect( checkChildResult ).to.true;
		} );
	} );

	describe( 'conversionApi', () => {
		let spy, spyP, spyText, viewP, viewText, modelP, modelText, rootMock, dispatcher,
			spyNull, spyArray, viewDiv, viewNull, viewArray;

		beforeEach( () => {
			spy = sinon.spy();
			spyP = sinon.spy();
			spyText = sinon.spy();

			viewP = new ViewContainerElement( 'p' );
			viewText = new ViewText( 'foobar' );
			modelP = new ModelElement( 'paragraph' );
			modelText = new ModelText( 'foobar' );

			// Put nodes to documentFragment, this will mock root element and makes possible to create range on them.
			rootMock = new ModelDocumentFragment( [ modelP, modelText ] );

			dispatcher = new UpcastDispatcher( { schema: model.schema } );

			dispatcher.on( 'element:p', ( evt, data ) => {
				spyP();

				data.modelRange = ModelRange._createOn( modelP );
				data.modelCursor = data.modelRange.end;
			} );

			dispatcher.on( 'text', ( evt, data ) => {
				spyText();

				data.modelRange = ModelRange._createOn( modelText );
				data.modelCursor = data.modelRange.end;
			} );

			spyNull = sinon.spy();
			spyArray = sinon.spy();

			viewDiv = new ViewContainerElement( 'div' ); // Will not be recognized and not converted.
			viewNull = new ViewContainerElement( 'null' ); // Will return `null` in `data.modelRange` upon conversion.
			viewArray = new ViewContainerElement( 'array' ); // Will return an array in `data.modelRange` upon conversion.

			dispatcher.on( 'element:null', ( evt, data ) => {
				spyNull();

				data.modelRange = null;
			} );

			dispatcher.on( 'element:array', ( evt, data ) => {
				spyArray();

				data.modelRange = [ new ModelText( 'foo' ) ];
			} );
		} );

		describe( 'convertItem()', () => {
			it( 'should call proper converter and return correct data', () => {
				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					spy();

					const pResult = conversionApi.convertItem( viewP, data.modelCursor );
					expect( pResult.modelRange ).instanceof( ModelRange );
					expect( pResult.modelRange.start.path ).to.deep.equal( [ 0 ] );
					expect( pResult.modelRange.end.path ).to.deep.equal( [ 1 ] );
					expect( first( pResult.modelRange.getItems() ) ).to.equal( modelP );
					expect( pResult.modelCursor ).to.instanceof( ModelPosition );
					expect( pResult.modelCursor.path ).to.deep.equal( [ 1 ] );

					const textResult = conversionApi.convertItem( viewText, data.modelCursor );
					expect( textResult.modelRange ).instanceof( ModelRange );
					expect( textResult.modelRange.start.path ).to.deep.equal( [ 1 ] );
					expect( textResult.modelRange.end.path ).to.deep.equal( [ 7 ] );
					expect( first( textResult.modelRange.getItems() ) ).to.instanceof( ModelTextProxy );
					expect( first( textResult.modelRange.getItems() ).data ).to.equal( 'foobar' );
					expect( textResult.modelCursor ).to.instanceof( ModelPosition );
					expect( textResult.modelCursor.path ).to.deep.equal( [ 7 ] );
				} );

				model.change( writer => dispatcher.convert( new ViewDocumentFragment(), writer ) );

				expect( spy.calledOnce ).to.be.true;
				expect( spyP.calledOnce ).to.be.true;
				expect( spyText.calledOnce ).to.be.true;
			} );

			it( 'should do nothing if element was not converted', () => {
				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					spy();

					expect( conversionApi.convertItem( viewDiv, data.modelCursor ).modelRange ).to.equal( null );
					expect( conversionApi.convertItem( viewNull, data.modelCursor ).modelRange ).to.equal( null );
				} );

				model.change( writer => dispatcher.convert( new ViewDocumentFragment(), writer ) );

				expect( spy.calledOnce ).to.be.true;
				expect( spyNull.calledOnce ).to.be.true;
			} );

			it( 'should throw an error if element was incorrectly converted', () => {
				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					spy();

					conversionApi.convertItem( viewArray, data.modelCursor );
				} );

				expect( () => {
					model.change( writer => dispatcher.convert( new ViewDocumentFragment(), writer ) );
				} ).to.throw( CKEditorError, /^view-conversion-dispatcher-incorrect-result/ );

				expect( spy.calledOnce ).to.be.true;
				expect( spyArray.calledOnce ).to.be.true;
			} );
		} );

		describe( 'convertChildren()', () => {
			it( 'should fire conversion for all children of passed element and return conversion results ' +
				'wrapped in document fragment', () => {
				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					spy();

					const result = conversionApi.convertChildren( data.viewItem, ModelPosition._createAt( rootMock, 0 ) );

					expect( result.modelRange ).to.be.instanceof( ModelRange );
					expect( result.modelRange.start.path ).to.deep.equal( [ 0 ] );
					expect( result.modelRange.end.path ).to.deep.equal( [ 7 ] );
					expect( Array.from( result.modelRange.getItems() ) ).to.length( 2 );
					expect( Array.from( result.modelRange.getItems() )[ 0 ] ).to.equal( modelP );
					expect( Array.from( result.modelRange.getItems() )[ 1 ] ).to.instanceof( ModelTextProxy );
					expect( Array.from( result.modelRange.getItems() )[ 1 ].data ).to.equal( 'foobar' );

					expect( result.modelCursor ).instanceof( ModelPosition );
					expect( result.modelCursor.path ).to.deep.equal( [ 7 ] );
				} );

				model.change( writer => dispatcher.convert( new ViewDocumentFragment( [ viewP, viewText ] ), writer ) );

				expect( spy.calledOnce ).to.be.true;
				expect( spyP.calledOnce ).to.be.true;
				expect( spyText.calledOnce ).to.be.true;
			} );
		} );

		describe( 'splitToAllowedParent()', () => {
			beforeEach( () => {
				model.schema.register( 'paragraph', {
					allowIn: '$root'
				} );
			} );

			it( 'should return current position if element is allowed on this position', () => {
				const spy = sinon.spy();

				model.schema.register( 'span', {
					allowIn: 'paragraph'
				} );

				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					const paragraph = conversionApi.writer.createElement( 'paragraph' );
					const span = conversionApi.writer.createElement( 'span' );
					const position = ModelPosition._createAt( paragraph, 0 );

					const result = conversionApi.splitToAllowedParent( span, position );

					expect( result ).to.deep.equal( { position } );
					spy();
				} );

				model.change( writer => dispatcher.convert( new ViewDocumentFragment(), writer ) );
				sinon.assert.calledOnce( spy );
			} );

			it( 'should split position to allowed ancestor if element is allowed in one of ancestors', () => {
				const spy = sinon.spy();

				model.schema.register( 'section', {
					allowIn: '$root'
				} );
				model.schema.register( 'span', {
					allowIn: 'paragraph'
				} );
				model.schema.extend( 'paragraph', {
					allowIn: 'section'
				} );

				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					const section = conversionApi.writer.createElement( 'section' );
					const paragraph = conversionApi.writer.createElement( 'paragraph' );
					const span = conversionApi.writer.createElement( 'span' );
					conversionApi.writer.insert( paragraph, section );
					conversionApi.writer.insert( span, paragraph );

					const position = ModelPosition._createAt( span, 0 );

					const paragraph2 = conversionApi.writer.createElement( 'paragraph' );
					const result = conversionApi.splitToAllowedParent( paragraph2, position );

					expect( result ).to.deep.equal( {
						position: ModelPosition._createAfter( paragraph ),
						cursorParent: paragraph.parent.getChild( 1 ).getChild( 0 )
					} );

					spy();
				} );

				model.change( writer => dispatcher.convert( new ViewDocumentFragment(), writer ) );
				sinon.assert.calledOnce( spy );
			} );

			it( 'should return null if element is not allowed in position and any of ancestors', () => {
				const spy = sinon.spy();

				model.schema.register( 'span' );

				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					const paragraph = conversionApi.writer.createElement( 'paragraph' );
					const span = conversionApi.writer.createElement( 'span' );
					const position = ModelPosition._createAt( paragraph, 0 );

					const result = conversionApi.splitToAllowedParent( span, position );

					expect( result ).to.null;
					spy();
				} );

				model.change( writer => dispatcher.convert( new ViewDocumentFragment(), writer ) );
				sinon.assert.calledOnce( spy );
			} );

			it( 'should return null if element is not allowed in position and any of ancestors but is allowed in context tree', () => {
				const spy = sinon.spy();

				model.schema.register( 'div', {
					allowIn: '$root',
				} );

				dispatcher.on( 'documentFragment', ( evt, data, conversionApi ) => {
					const code = conversionApi.writer.createElement( 'div' );
					const result = conversionApi.splitToAllowedParent( code, data.modelCursor );

					expect( result ).to.null;
					spy();
				} );

				model.change( writer => dispatcher.convert( new ViewDocumentFragment(), writer, [ '$root', 'paragraph' ] ) );
				sinon.assert.calledOnce( spy );
			} );
		} );

		describe( 'getSplitParts()', () => {
			it( 'should return an array containing only passed element if the element has not been split', () => {
				model.schema.register( 'paragraph', { allowIn: '$root' } );

				const spy = sinon.spy();

				dispatcher.on( 'element', ( evt, data, conversionApi ) => {
					const modelElement = conversionApi.writer.createElement( 'paragraph' );
					const parts = conversionApi.getSplitParts( modelElement );

					expect( parts ).to.deep.equal( [ modelElement ] );

					spy();

					// Overwrite converters specified in `beforeEach`.
					evt.stop();
				}, { priority: 'high' } );

				const viewElement = new ViewElement( 'p' );

				model.change( writer => dispatcher.convert( viewElement, writer ) );

				expect( spy.called ).to.be.true;
			} );

			it( 'should return all parts of the split element', () => {
				model.schema.register( 'paragraph', { allowIn: '$root' } );
				model.schema.register( 'text', { allowIn: 'paragraph' } );
				model.schema.register( 'image', { allowIn: '$root' } );

				dispatcher.on( 'text', ( evt, data, conversionApi ) => {
					const modelText = conversionApi.writer.createText( data.viewItem.data );

					conversionApi.writer.insert( modelText, data.modelCursor );

					data.modelRange = conversionApi.writer.createRangeOn( modelText );
					data.modelCursor = data.modelRange.end;

					// Overwrite converters specified in `beforeEach`.
					evt.stop();
				}, { priority: 'high' } );

				dispatcher.on( 'element:image', ( evt, data, conversionApi ) => {
					const modelElement = conversionApi.writer.createElement( 'image' );

					const splitResult = conversionApi.splitToAllowedParent( modelElement, data.modelCursor );

					conversionApi.writer.insert( modelElement, splitResult.position );

					data.modelRange = conversionApi.writer.createRangeOn( modelElement );
					data.modelCursor = conversionApi.writer.createPositionAt( splitResult.cursorParent, 0 );

					// Overwrite converters specified in `beforeEach`.
					evt.stop();
				}, { priority: 'high' } );

				const spy = sinon.spy();

				dispatcher.on( 'element:p', ( evt, data, conversionApi ) => {
					const modelElement = conversionApi.writer.createElement( 'paragraph' );

					conversionApi.writer.insert( modelElement, data.modelCursor );
					conversionApi.convertChildren( data.viewItem, conversionApi.writer.createPositionAt( modelElement, 0 ) );

					const parts = conversionApi.getSplitParts( modelElement );

					expect( parts.length ).to.equal( 3 );

					expect( parts[ 0 ].getChild( 0 ).data ).to.equal( 'foo' );
					expect( parts[ 1 ].getChild( 0 ).data ).to.equal( 'bar' );
					expect( parts[ 2 ].getChild( 0 ).data ).to.equal( 'xyz' );

					expect( parts[ 0 ] ).to.equal( modelElement );

					spy();

					// Overwrite converters specified in `beforeEach`.
					evt.stop();
				}, { priority: 'high' } );

				const viewElement = new ViewElement( 'p', null, [
					new ViewText( 'foo' ),
					new ViewElement( 'image' ),
					new ViewText( 'bar' ),
					new ViewElement( 'image' ),
					new ViewText( 'xyz' )
				] );

				model.change( writer => dispatcher.convert( viewElement, writer, [ '$root' ] ) );

				expect( spy.called ).to.be.true;
			} );
		} );
	} );
} );
