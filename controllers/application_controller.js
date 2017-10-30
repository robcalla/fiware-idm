var models = require('../models/models.js');
var fs = require('fs');
var mmm = require('mmmagic'),
    Magic = mmm.Magic;

var Sequelize = require('sequelize');
const Op = Sequelize.Op;

var magic = new Magic(mmm.MAGIC_MIME_TYPE);


// Autoload info if path include applicationid
exports.load = function(req, res, next, applicationId) {
	if (!("application" in req.session) || req.session.application.id != applicationId) {
		models.oauth_client.findById(applicationId).then(function(application) {
			if (application) {
				req.session.application = application
				if (application.image == 'default') {
					req.session.application.image = '/img/logos/original/app.png'
				} else {
					req.session.application.image = '/img/applications/'+application.image
				}					
				models.role_user.findAll({
					where: { oauth_client_id: req.session.application.id },
					include: [{
						model: models.user,
						attributes: ['id', 'username']
					}]
				}).then(function(users_application) {
					if (users_application) {
						var users_authorized = []
						users_application.forEach(function(app) {
								users_authorized.push({ user_id: app.User.id, 
														role_id: app.role_id, 
														username: app.User.username});
						});
						req.session.application_users_authorized = users_authorized;
						next();
					} else { next(new Error("The applications hasn't got users authorized"));}
				}).catch(function(error) { next(error); });	
			} else { next(new Error("The application with id " + applicationId + "doesn't exist"));}
		}).catch(function(error) { next(error); });
	} else {
		next();
	}
};

// List all applications
exports.index = function(req, res) {
	models.role_user.findAll({
		where: { user_id: req.session.user.id },
		include: [{
			model: models.oauth_client,
			attributes: ['id', 'name', 'url', 'image']
		}]
	}).then(function(user_applications) {
		if (user_applications) {
			var applications = []
			user_applications.forEach(function(app) {
				if (applications.length == 0 || !applications.some(elem => (elem.id == app.OauthClient.id))) {
					if (app.OauthClient.image == 'default') {
						app.OauthClient.image = '/img/logos/medium/app.png'
					} else {
						app.OauthClient.image = '/img/applications/'+app.OauthClient.image
					}
					applications.push(app.OauthClient)
				} 
			});

			if (req.session.message) {
				res.locals.message = req.session.message;
				delete req.session.message
			}
			res.render('applications/index', { applications: applications, errors: []});
		}
	});
};

// Show info about an application
exports.show = function(req, res) {
	if (req.session.message) {
		res.locals.message = req.session.message;
		delete req.session.message
	}
	res.render('applications/show', { application: req.session.application, 
									  users_authorized: req.session.application_users_authorized, 
									  roles: req.session.application_roles,
									  errors: [] });
};

// Form for new application
exports.new = function(req, res) {
	res.render('applications/new', {application: {}, errors: []})
};
	
// Create new application
exports.create = function(req, res, next) {
	if (req.body.id || req.body.secret) {
		req.session.message = {text: ' Application creation failed.', type: 'danger'};
		res.redirect('/idm/applications')
	} else {
		var application = models.oauth_client.build(req.body.application);
		application.validate().then(function(err) {
			application.save({fields: ['id', 'name', 'description', 'url', 'redirect_uri', 'secret', 'image']}).then(function(){
            	models.role.findOne({ where: { id: 'provider', oauth_client_id: 'idm_admin_app' } }).then(function(role) {
            		models.role_user.create({ oauth_client_id: application.id, role_id: role.id, user_id: req.session.user.id}).then(function(newAssociation) {
						res.redirect('/idm/applications/'+application.id+'/step/avatar');
					}).catch(function(error) {
			 			res.render('applications/new', { application: application, errors: error.errors}); 
					});	
            	})
			}).catch(function(error) {
				res.render('applications/new', { application: application, errors: error.errors});
			});
		}).catch(function(error){ 
		 	res.render('applications/new', { application: application, errors: error.errors}); 
		});
	}	
};

// Form to create avatar when creating an application
exports.step_new_avatar = function(req, res, next) {
	res.render('applications/step_create_avatar', { application: req.session.application, errors: []});
};

// Create Avatar when creating an application
exports.step_create_avatar = function(req, res, next) {

	if (req.file) {
		var types = ['jpg', 'jpeg', 'png']
		magic.detectFile('public/img/applications/'+req.file.filename, function(err, result) {
			if (types.includes(String(result.split('/')[1]))) {
				models.oauth_client.update(
					{ image: req.file.filename },
					{
						fields: ["image"],
						where: {id: req.session.application.id }
					}
				).then(function(){
					req.session.application.image = '/img/applications/'+req.file.filename
					res.redirect('/idm/applications/'+req.session.application.id+'/step/roles');
				}).catch(function(error) {
					res.send('error')
				});
			} else {
				fs.unlink('./public/img/applications/'+req.file.filename, (err) => {
					req.session.message = {text: ' Inavalid file.', type: 'danger'};
					res.redirect('/idm/applications/'+req.session.application.id);            
				});
			}	
		});
	} else {
		req.session.application.image = '/img/logos/original/app.png'
		res.redirect('/idm/applications/'+req.session.application.id+'/step/roles');
	}
};

// Form to assign roles when creating an application
exports.step_new_roles = function(req, res, next) {

	models.role.findAll({
		where: { [Op.or]: [{oauth_client_id: req.session.application.id}, {is_internal: true}] },
		attributes: ['id', 'name'],
		order: [['id', 'DESC']]
	}).then(function(roles) {
		if (roles) {
			models.permission.findAll({
				where: { [Op.or]: [{oauth_client_id: req.session.application.id}, {is_internal: true}] },
				attributes: ['id', 'name'], 
				order: [['id', 'ASC']]
			}).then(function(permissions) {
				if (permissions) {
					models.role_permission.findAll({
						where: { role_id: roles.map(elem => elem.id) }						
					}).then(function(application_roles_permissions) {
						if (application_roles_permissions) {
							role_permission_assign = {}
							for (var i = 0; i < application_roles_permissions.length; i++) {
								if (!role_permission_assign[application_roles_permissions[i].role_id]) {
							        role_permission_assign[application_roles_permissions[i].role_id] = [];
							    }
							    role_permission_assign[application_roles_permissions[i].role_id].push(application_roles_permissions[i].permission_id);
							}
							req.session.application_roles = roles
							res.render('applications/step_create_roles', { application: { id: req.session.application.id, 
																					 roles: roles, 
																					 permissions: permissions,
																					 role_permission_assign: role_permission_assign }});
						}
					}).catch(function(error) { next(error); });
				}
			}).catch(function(error) { next(error); });
		} else { next(new Error("Problems when searching roles"));}
	}).catch(function(error) { next(error); });
};

// Edit application
exports.edit = function(req, res) {
  res.render('applications/edit', { application: req.session.application, errors: []});
};

// Update application avatar
exports.update_avatar = function(req, res) {

	var types = ['jpg', 'jpeg', 'png']
	if (req.file) {
		req.body.application = JSON.parse(JSON.stringify(req.session.application))
		req.body.application['image'] = req.file.filename

		magic.detectFile('public/img/applications/'+req.file.filename, function(err, result) {

			if (err) throw err;

			if (types.includes(String(result.split('/')[1]))) {
				req.body.application["id"] = req.session.application.id
				var application = models.oauth_client.build(req.body.application);

					models.oauth_client.update(
						{ image: req.body.application.image },
						{
							fields: ['image'],
							where: {id: req.session.application.id}
						}
					).then(function() {
						req.session.application.image = '/img/applications/'+req.body.application.image
						req.session.message = {text: ' Application updated successfully.', type: 'success'};
						res.redirect('/idm/applications/'+req.session.application.id);
					}).catch(function(error){ 
						res.locals.message = {text: ' Application update failed.', type: 'warning'};
					 	res.render('applications/edit', { application: req.body.application, errors: error.errors});
					});	
			} else {
				fs.unlink('./public/img/applications/'+req.file.filename, (err) => {
					req.session.message = {text: ' Inavalid file.', type: 'danger'};
					res.redirect('/idm/applications/'+req.session.application.id);            
				});
			}
	  	});
  	} 
};

// Update application information
exports.update_info = function(req, res) {

	if (req.body.id || req.body.secret) {
		res.locals.message = {text: ' Application edit failed.', type: 'danger'};
		res.redirect('/idm/applications/'+req.session.application.id)
	} else {

		req.body.application["id"] = req.session.application.id;
		var application = models.oauth_client.build(req.body.application);

		application.validate().then(function(err) {
			models.oauth_client.update(
				{ name: req.body.application.name,
				  description: req.body.application.description,
				  url: req.body.application.url,
				  redirect_uri: req.body.application.redirect_uri },
				{
					fields: ['name','description','url','redirect_uri'],
					where: {id: req.session.application.id}
				}
			).then(function() {
				req.session.application.name = req.body.application.name;
				req.session.application.description = req.body.application.description;
				req.session.application.url = req.body.application.url;
				req.session.application.redirect_uri = req.body.application.redirect_uri;
				req.session.message = {text: ' Application updated successfully.', type: 'success'};
				res.redirect('/idm/applications/'+req.session.application.id);
			});	
		}).catch(function(error){ 
			res.locals.message = {text: ' Application update failed.', type: 'warning'};
		 	res.render('applications/edit', { application: req.body.application, errors: error.errors});
		});
	}
};

// Show roles and permissions
exports.manage_roles = function(req, res, next) {

	models.role.findAll({
		where: { [Op.or]: [{oauth_client_id: req.session.application.id}, {is_internal: true}] },
		attributes: ['id', 'name'],
		order: [['id', 'DESC']]
	}).then(function(roles) {
		if (roles) {
			models.permission.findAll({
				where: { [Op.or]: [{oauth_client_id: req.session.application.id}, {is_internal: true}] },
				attributes: ['id', 'name'], 
				order: [['id', 'ASC']]
			}).then(function(permissions) {
				if (permissions) {
					models.role_permission.findAll({
						where: { role_id: roles.map(elem => elem.id) }						
					}).then(function(application_roles_permissions) {
						if (application_roles_permissions) {
							role_permission_assign = {}
							for (var i = 0; i < application_roles_permissions.length; i++) {
								if (!role_permission_assign[application_roles_permissions[i].role_id]) {
							        role_permission_assign[application_roles_permissions[i].role_id] = [];
							    }
							    role_permission_assign[application_roles_permissions[i].role_id].push(application_roles_permissions[i].permission_id);
							}
							req.session.application_roles = roles
							res.render('applications/manage_roles', { application: { id: req.session.application.id, 
																					 roles: roles, 
																					 permissions: permissions,
																					 role_permission_assign: role_permission_assign }});
						}
					}).catch(function(error) { next(error); });
				}
			}).catch(function(error) { next(error); });
		} else { next(new Error("Problems when searching roles"));}
	}).catch(function(error) { next(error); });

}

// Create new roles
exports.create_role = function(req, res) {

	if (req.body.id || req.body.is_internal) {
		res.send({text: ' Failed creating role', type: 'danger'});
	} else {

		var role = models.role.build({ name: req.body.name, 
								   oauth_client_id: req.session.application.id });

		role.validate().then(function(err) {
			role.save({fields: ["id", "name", "oauth_client_id"]}).then(function() {
				req.session.application_roles.push({id: role.id, name: role.name})
				var message = {text: ' Create role', type: 'success'}
				res.send({role: role, message: message});
			})
		}).catch(function(error) {
			res.send({text: error.errors[0].message, type: 'warning'});			
		});
	}
}

// Edit role
exports.edit_role = function(req, res) {
	var role_name = req.body.role_name;
	var role_id = req.body.role_id;

	if (['provider', 'purchaser'].includes(role_id) || req.body.is_internal) {
		res.send({text: ' Failed editing role', type: 'danger'});
	
	} else {

		var role = models.role.build({ name: role_name, 
									   oauth_client_id: req.session.application.id });

		role.validate().then(function(err) {
			models.role.update(
				{ name: role_name },
				{
					fields: ["name"],
					where: {id: role_id}
				}
			).then(function(){
				var index = req.session.application_roles.findIndex(elem => elem.id === role_id); 
		        if (index > -1) {
		        	req.session.application_roles[index].name = role_name;        	
		        }	
				res.send({text: ' Role was successfully edited.', type: 'success'});
			}).catch(function(error) {
				res.send({text: ' Failed editing role.', type: 'danger'})
			});
		}).catch(function(error) {
			res.send({text: error.errors[0].message, type: 'warning'})
		});
	}
}

// Delete role
exports.delete_role = function(req, res) {

	if (['provider', 'purchaser'].includes(req.body.role_id) || req.body.is_internal) {
		res.send({text: ' Failed deleting role', type: 'danger'});
	
	} else {

		models.role.destroy({
		where: { id: req.body.role_id,
				 oauth_client_id: req.body.app_id 
				}
		}).then(function() {
			var index = req.session.application_roles.findIndex(elem => elem.id === req.body.role_id); 
	        if (index > -1) {
	        	req.session.application_roles.splice(index, 1);        	
	        }
			res.send({text: ' Role was successfully deleted.', type: 'success'});
		}).catch(function(error) {
			res.send({text: ' Failed deleting role', type: 'danger'});
		});	
	}
}

// Create new permissions
exports.create_permission = function(req, res) {

	if (req.body.id || req.body.is_internal) {
		res.send({text: ' Failed creating permission', type: 'danger'});
	} else {
		var permission = models.permission.build({ name: req.body.name,
											 description: req.body.description,
											 action: req.body.action,
											 resource: req.body.resource,
											 xml: req.body.xml, 
											 oauth_client_id: req.session.application.id });

		permission.validate().then(function(err) {
			permission.save({fields: ["id", "name", "description", "action", "resource", "xml", "oauth_client_id"]}).then(function() {
				var message = {text: ' Create permission', type: 'success'}
				res.send({permission: permission, message: message});
			})
		}).catch(function(error) {
			res.send({text: error.errors, type: 'warning'});
		});
	}
}

// Assing permissions to roles 
exports.role_permissions_assign = function(req, res) {
	
	var roles_id = Object.keys(JSON.parse(req.body.submit_assignment))
	var public_roles_id = roles_id.filter(elem => !['provider','purchaser'].includes(elem))

	models.role_permission.destroy({
		where: { 
			role_id: public_roles_id
		}
	}).then(function() {
		var submit_assignment = JSON.parse(req.body.submit_assignment);
		create_assign_roles_permissions = []
		for(var role in submit_assignment) {
			if (!['provider', 'purchaser'].includes(role)) {
				for (var permission = 0; permission < submit_assignment[role].length; permission++) {
					create_assign_roles_permissions.push({role_id: role, permission_id: submit_assignment[role][permission], oauth_client_id: req.session.application.id})
				}
			}
		}

		models.role_permission.bulkCreate(create_assign_roles_permissions).then(function() {
			req.session.message = {text: ' Modified roles and permissions.', type: 'success'};
			res.redirect("/idm/applications/"+req.session.application.id)
		}).catch(function(error) {
			req.session.message = {text: ' Roles and permissions assignment error.', type: 'warning'};
			res.redirect("/idm/applications/"+req.session.application.id)
		});
	}).catch(function(error) {
		req.session.message = {text: ' Roles and permissions assignment error.', type: 'warning'};
		res.redirect("/idm/applications/"+req.session.application.id)
	});
}

// Delete avatar
exports.delete_avatar = function(req, res) {
	if (!req.body.image_name.includes('/img/applications')) {
		res.send({text: ' Cannot delete default image.', type: 'danger'});
	} else {
		models.oauth_client.update(
			{ image: 'default' },
			{
				fields: ["image"],
				where: {id: req.session.application.id }
			}
		).then(function(){
			var image_name = req.body.image_name.split('/')[3]
			fs.unlink('./public/img/applications/'+image_name, (err) => {
		        if (err) {
		            res.send({text: ' Failed to delete image.', type: 'warning'});
		        } else {
		        	req.session.application.image = '/img/logos/original/app.png'
		            res.send({text: ' Deleted image.', type: 'success'});                               
		        }
			});
		}).catch(function(error) {
			res.send('error')
		});
	}
};

// Delete application
exports.destroy = function(req, res) {
	if (req.session.application.image.includes('/img/applications')) {
		var image_name = req.session.application.image.split('/')[3]
		fs.unlink('./public/img/applications/'+image_name);
	}
	models.oauth_client.destroy({
		where: { id: req.session.application.id }
	}).then(function() {
		req.session.message = {text: ' Application deleted.', type: 'success'};
		res.redirect('/idm/applications')
	}).catch(function(error) {
		req.session.message = {text: ' Application delete error.', type: 'warning'};
		res.redirect('/idm/applications');
	});
};


// Authorize users in an application
exports.available_users = function(req, res) {

	var key = req.body.username
	models.user.findAll({
	 	attributes: ['username', 'id'],
		where: {
            username: {
                like: '%' + key + '%'
            }
        }
	}).then(function(users) {
		if (users.length > 0) {
			res.send(users)
		} else {
			res.send('no_users_found')
		}
	});

}

// Authorize users in an application
exports.authorize_users = function(req, res) {

	models.role_user.destroy({
		where: { oauth_client_id: req.session.application.id }
	}).then(function() {
		var submit_authorize_users = req.body.submit_authorize; 
		req.session.application_users_authorized = JSON.parse(JSON.stringify(submit_authorize_users))

		for (var i = 0; i < submit_authorize_users.length; i++) {
			submit_authorize_users[i].oauth_client_id = req.session.application.id;
			delete submit_authorize_users[i].username
		}

		models.role_user.bulkCreate(submit_authorize_users).then(function() {
			res.send({text: ' Modified users authorization.', type: 'success'})
		}).catch(function(error) {
			res.send({text: ' Modified users authorization error.', type: 'warning'})
		});

	}).catch(function(error) {
		res.send({text: ' Modified users authorization error.', type: 'warning'})
	});
}

