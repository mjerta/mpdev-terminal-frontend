import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MainContainer } from './main-container';

describe('MainContainer', () => {
  let component: MainContainer;
  let fixture: ComponentFixture<MainContainer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainContainer],
    }).compileComponents();

    fixture = TestBed.createComponent(MainContainer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
