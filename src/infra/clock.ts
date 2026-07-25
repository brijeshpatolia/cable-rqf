/**
 * The clock, in one place.
 *
 * Pages used to import a frozen `NOW` from the seed module, which was fine
 * when every screen rendered from a static snapshot. Against a live database
 * that constant would quietly pin the whole app to January and no rate entered
 * after it would ever be in force.
 *
 * Kept behind a function so tests can pass an instant explicitly rather than
 * mocking global time.
 */
export function now(): Date {
  return new Date();
}
