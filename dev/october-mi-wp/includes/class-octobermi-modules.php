<?php
/**
 * Module system.
 *
 * The plugin is a single client-side surface for the October Marketing
 * Platform. Each capability (Blog Autopilot first; more later) is a self
 * contained module. A module contributes NOTHING until it is switched on in
 * Settings — no menu item, no admin assets, no hooks, no scheduled jobs — so an
 * install that only wants one thing stays small and simple.
 *
 * Contract:
 *   - Modules are registered once, on load (see the main plugin file).
 *   - Only enabled modules are booted (OctoberMI_Modules::boot_enabled()).
 *   - boot() is where a module wires up its menu / hooks / assets. It runs only
 *     when the module is enabled, so disabled modules cost nothing at runtime.
 *   - activate() runs once, the moment a module is switched on (create tables,
 *     seed defaults). It is safe to run repeatedly (must be idempotent).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Base class every module extends.
 */
abstract class OctoberMI_Module {

	/** Stable machine id, e.g. 'blog'. Used as the settings key and menu slug. */
	abstract public function id();

	/** Human, client-facing label, e.g. 'Blog Autopilot'. */
	abstract public function label();

	/** One-line description shown next to the enable checkbox. */
	public function description() {
		return '';
	}

	/**
	 * Wire up the module. Called ONLY when the module is enabled. Register the
	 * admin menu, hooks, REST routes, cron, and asset loading here.
	 */
	public function boot() {}

	/**
	 * One-time setup when the module is switched on. Must be idempotent.
	 */
	public function activate() {}
}

/**
 * The registry. Holds every known module and boots the enabled ones.
 */
class OctoberMI_Modules {

	/** @var OctoberMI_Module[] keyed by id */
	protected static $registry = array();

	/** Register a module instance. Later registrations of the same id win. */
	public static function register( OctoberMI_Module $module ) {
		self::$registry[ $module->id() ] = $module;
	}

	/** @return OctoberMI_Module[] every registered module, keyed by id. */
	public static function all() {
		return self::$registry;
	}

	/** @return OctoberMI_Module|null */
	public static function get( $id ) {
		return isset( self::$registry[ $id ] ) ? self::$registry[ $id ] : null;
	}

	/** Boot only the modules the site has switched on. */
	public static function boot_enabled() {
		foreach ( self::$registry as $id => $module ) {
			if ( OctoberMI_Settings::is_module_enabled( $id ) ) {
				$module->boot();
			}
		}
	}
}
